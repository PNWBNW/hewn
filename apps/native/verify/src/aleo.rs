//! What this verifier checks with Aleo's own primitives (snarkVM's console crates), beyond what
//! the website's `/verify` checks:
//!
//! - A transaction id is a real one: bech32m with its checksum, a field element
//!   (`/verify` checks the characters and the length only).
//! - The anchoring transaction commits to the root. `anchor_event`'s input is private, but the
//!   future it returns carries the argument in public. From the transaction as the explorer serves
//!   it, this recomputes, with snarkVM's hashes:
//!   1. the future's output id: Poseidon8 over (function id, the future's fields, tcm, index),
//!      the function id being BHP1024 over (network, program, function);
//!   2. every transition id: BHP512 over (the root of the BHP Merkle tree of its input and output
//!      leaves, tcm);
//!   3. the transaction id: the root of the BHP Merkle tree of its transitions' ids and the fee's.
//!
//!   So the explorer can't show a different argument for the transaction the books recorded
//!   (`anchorTx`) without the ids failing to match. It still says nothing about whether the
//!   transaction is in an accepted block: that, like the mapping, is the explorer's word.

use std::str::FromStr;

use serde_json::Value;
use snarkvm_console::network::{Network, TestnetV0};
use snarkvm_console::prelude::ToBits;
use snarkvm_console::program::{
    Argument, Identifier, Literal, OutputID, Plaintext, ProgramID, TRANSACTION_DEPTH, TRANSITION_DEPTH, TransactionLeaf, TransitionLeaf,
    Value as AleoValue, compute_function_id,
};
use snarkvm_console::types::{Field, U16};

use crate::chain::{ANCHOR_EVENT, AUDIT_LOG_PROGRAM};
use crate::generated::config;

/// The network the explorer serves (@pnw/config): testnet.
pub type N = TestnetV0;

/// Whether `id` is a transaction id snarkVM reads (`at1…`, with a valid checksum).
pub fn is_transaction_id(id: &str) -> bool {
    config::NETWORK == "testnet" && <N as Network>::TransactionID::from_str(id).is_ok()
}

/// What recomputing an anchoring transaction showed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnchorTx {
    pub transaction: String,
    pub transition: String,
}

fn field(v: Option<&Value>, what: &str) -> Result<Field<N>, String> {
    let s = v.and_then(Value::as_str).ok_or(format!("The transaction has no {what}"))?;
    Field::<N>::from_str(s).map_err(|_| format!("The transaction's {what} isn't a field element"))
}

fn input_variant(kind: &str) -> Option<u8> {
    Some(match kind {
        "constant" => 0,
        "public" => 1,
        "private" => 2,
        "record" => 3,
        "external_record" => 4,
        _ => return None,
    })
}

fn output_variant(kind: &str) -> Option<u8> {
    Some(match kind {
        "constant" => 0,
        "public" => 1,
        "private" => 2,
        "record" => 3,
        "external_record" => 4,
        "future" => 5,
        _ => return None,
    })
}

/// A transition's id from its inputs, outputs and tcm, as snarkVM computes it.
fn transition_id(t: &Value) -> Result<Field<N>, String> {
    let empty = Vec::new();
    let inputs = t.get("inputs").and_then(Value::as_array).unwrap_or(&empty);
    let outputs = t.get("outputs").and_then(Value::as_array).unwrap_or(&empty);
    let mut leaves = Vec::new();
    for (i, input) in inputs.iter().enumerate() {
        let kind = input.get("type").and_then(Value::as_str).unwrap_or("");
        let variant = input_variant(kind).ok_or(format!("A transition input of a kind this verifier doesn't read: {kind}"))?;
        let id = field(input.get("id"), "input id")?;
        leaves.push(TransitionLeaf::<N>::new(u8::try_from(i).map_err(|_| "Too many inputs")?, variant, id).to_bits_le());
    }
    for (j, output) in outputs.iter().enumerate() {
        let kind = output.get("type").and_then(Value::as_str).unwrap_or("");
        let variant = output_variant(kind).ok_or(format!("A transition output of a kind this verifier doesn't read: {kind}"))?;
        let id = field(output.get("id"), "output id")?;
        let index = u8::try_from(inputs.len() + j).map_err(|_| "Too many outputs")?;
        leaves.push(TransitionLeaf::<N>::new(index, variant, id).to_bits_le());
    }
    let tree = N::merkle_tree_bhp::<TRANSITION_DEPTH>(&leaves).map_err(|e| format!("The transition's tree: {e}"))?;
    let tcm = field(t.get("tcm"), "transition commitment (tcm)")?;
    let mut bits = tree.root().to_bits_le();
    bits.extend(tcm.to_bits_le());
    N::hash_bhp512(&bits).map_err(|e| format!("The transition id: {e}"))
}

/// Whether the transaction the explorer served as `tx` is `expected_id`, an execution of
/// `payroll_audit_log.aleo/anchor_event` whose public future carries `root`, with every id along
/// the way recomputed. Ok names the transaction and the transition; Err says what failed.
pub fn anchor_tx_commits(tx: &Value, expected_id: &str, root: &[u8; 32]) -> Result<AnchorTx, String> {
    let claimed = <N as Network>::TransactionID::from_str(expected_id).map_err(|_| format!("{expected_id} isn't a transaction id"))?;
    if tx.get("id").and_then(Value::as_str) != Some(expected_id) {
        return Err("The explorer sent another transaction".into());
    }
    if tx.get("type").and_then(Value::as_str) != Some("execute") {
        return Err("The transaction isn't an execution".into());
    }
    let transitions = tx
        .pointer("/execution/transitions")
        .and_then(Value::as_array)
        .ok_or("The transaction has no transitions")?;
    if transitions.is_empty() {
        return Err("The transaction has no transitions".into());
    }
    let program = ProgramID::<N>::from_str(AUDIT_LOG_PROGRAM).map_err(|e| e.to_string())?;
    let function = Identifier::<N>::from_str(ANCHOR_EVENT).map_err(|e| e.to_string())?;
    let function_id = compute_function_id(&U16::<N>::new(N::ID), &program, &function).map_err(|e| e.to_string())?;

    let mut leaves = Vec::new();
    let mut anchored: Option<String> = None;
    for (index, t) in transitions.iter().enumerate() {
        let id = transition_id(t)?;
        let said = t.get("id").and_then(Value::as_str).unwrap_or("");
        let said_id = <N as Network>::TransitionID::from_str(said).map_err(|_| format!("Transition {index} has no transition id"))?;
        if *said_id != id {
            return Err(format!("Transition {said} doesn't recompute to its id"));
        }
        let is_anchor = t.get("program").and_then(Value::as_str) == Some(AUDIT_LOG_PROGRAM)
            && t.get("function").and_then(Value::as_str) == Some(ANCHOR_EVENT);
        if is_anchor && anchored.is_none() && future_carries(t, function_id, root)? {
            anchored = Some(said.to_string());
        }
        leaves.push(TransactionLeaf::<N>::new_execution(u16::try_from(index).map_err(|_| "Too many transitions")?, id).to_bits_le());
    }
    if let Some(fee) = tx.pointer("/fee/transition") {
        let id = transition_id(fee)?;
        let said = fee.get("id").and_then(Value::as_str).unwrap_or("");
        let said_id = <N as Network>::TransitionID::from_str(said).map_err(|_| "The fee has no transition id".to_string())?;
        if *said_id != id {
            return Err("The fee's transition doesn't recompute to its id".into());
        }
        leaves.push(TransactionLeaf::<N>::new_fee(u16::try_from(transitions.len()).map_err(|_| "Too many transitions")?, id).to_bits_le());
    }
    let tree = N::merkle_tree_bhp::<TRANSACTION_DEPTH>(&leaves).map_err(|e| format!("The transaction's tree: {e}"))?;
    if *tree.root() != *claimed {
        return Err("The transaction doesn't recompute to its id".into());
    }
    let transition = anchored.ok_or(format!(
        "The transaction doesn't call {AUDIT_LOG_PROGRAM}/{ANCHOR_EVENT} with this root"
    ))?;
    Ok(AnchorTx {
        transaction: expected_id.to_string(),
        transition,
    })
}

/// Whether one of the transition's outputs is the future of `anchor_event(root)` and recomputes
/// to its output id. An output that names the root but doesn't recompute is an error.
fn future_carries(t: &Value, function_id: Field<N>, root: &[u8; 32]) -> Result<bool, String> {
    let inputs = t.get("inputs").and_then(Value::as_array).map_or(0, Vec::len);
    let tcm = field(t.get("tcm"), "transition commitment (tcm)")?;
    let Some(outputs) = t.get("outputs").and_then(Value::as_array) else {
        return Ok(false);
    };
    for (j, output) in outputs.iter().enumerate() {
        if output.get("type").and_then(Value::as_str) != Some("future") {
            continue;
        }
        let text = output.get("value").and_then(Value::as_str).ok_or("A future output has no value")?;
        let value = AleoValue::<N>::from_str(text).map_err(|_| "A future output isn't a future snarkVM reads".to_string())?;
        let AleoValue::Future(future) = &value else { continue };
        if future.program_id().to_string() != AUDIT_LOG_PROGRAM || future.function_name().to_string() != ANCHOR_EVENT {
            continue;
        }
        let [Argument::Plaintext(Plaintext::Array(items, _))] = future.arguments() else {
            continue;
        };
        let bytes: Option<Vec<u8>> = items
            .iter()
            .map(|p| match p {
                Plaintext::Literal(Literal::U8(b), _) => Some(**b),
                _ => None,
            })
            .collect();
        if bytes.as_deref() != Some(&root[..]) {
            continue;
        }
        let index = u16::try_from(inputs + j).map_err(|_| "Too many outputs")?;
        let id = OutputID::future(function_id, &value, tcm, index).map_err(|e| e.to_string())?;
        let said = field(output.get("id"), "output id")?;
        if *id.id() != said {
            return Err("The future naming this root doesn't recompute to its output id".into());
        }
        return Ok(true);
    }
    Ok(false)
}
