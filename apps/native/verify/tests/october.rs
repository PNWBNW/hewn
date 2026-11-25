//! October 2026, closed and anchored on testnet on 2026-11-07 (progress/2026-11/2026-11-07.md):
//! October 25 to 31, anchored through payroll_audit_log.aleo/anchor_event in transaction
//! at1hg2etspa…, block 21,235,519. Its proof file isn't in this repository (it holds wages), so
//! what is checked is its public data: the root, which the transaction's public future carries,
//! the anchor, and the transaction itself, recomputed with snarkVM.
//!
//! The offline tests use a trimmed copy of the transaction as the explorer served it
//! (tests/fixtures/october_anchor_tx.json). `live_october_is_anchored` reads the real explorer and
//! is ignored by default: `cargo test --locked -- --ignored`.

mod common;

use common::*;
use pnw_verify::aleo::{anchor_tx_commits, is_transaction_id};
use pnw_verify::chain::HttpExplorer;
use pnw_verify::period::{AFTER, ANCHORED, COMMITS, verify_public};
use serde_json::{Value, json};

const ROOT: &str = "95496641a8ea9ac3f9a99ecb33e7d172ba6d99efcd0e606dfdc8c2c6f904e68b";
const TX: &str = "at1hg2etspa7udc6nj6yja2uc7p9fnf49l9973jvh9467w277mpx5rqp500eq";
const TRANSITION: &str = "au1nspzdw9kram5a7kzerrx0dc6dy5qqjzqes2ljksn04f3l3q02cfqcm4mqe";
const HEIGHT: u64 = 21_235_519;
const BLOCK_TIME: i64 = 1_794_082_364; // 2026-11-07T20:12:44Z

fn tx() -> Value {
    serde_json::from_str(&std::fs::read_to_string(fixture("october_anchor_tx.json")).unwrap()).unwrap()
}

fn root() -> [u8; 32] {
    let v: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&ROOT[i..i + 2], 16).unwrap())
        .collect();
    v.try_into().unwrap()
}

fn explorer(tx: Value) -> Table {
    Table::default()
        .json(&anchor_path(ROOT), json!(format!("{HEIGHT}u32")))
        .json(
            &format!("/block/{HEIGHT}"),
            json!({ "header": { "metadata": { "timestamp": BLOCK_TIME } } }),
        )
        .json(&format!("/transaction/{TX}"), tx)
}

#[test]
fn octobers_transaction_carries_its_root_recomputed_with_snarkvm() {
    let found = anchor_tx_commits(&tx(), TX, &root()).unwrap();
    assert_eq!(found.transaction, TX);
    assert_eq!(found.transition, TRANSITION);
}

#[test]
fn octobers_public_data_verifies() {
    let report = verify_public(ROOT, "2026-10-31", Some(TX), &explorer(tx()));
    assert!(report.passed(), "{}", report.text());
    let by = |label: &str| report.checks.iter().find(|c| c.label == label).unwrap().detail.clone();
    assert_eq!(by(ANCHORED), "In block 21,235,519");
    assert_eq!(by(AFTER), "On 2026-11-07, after 2026-10-31");
    assert!(by(COMMITS).contains(TRANSITION));
}

#[test]
fn a_wrong_root_is_refused() {
    let mut other = root();
    other[0] ^= 1;
    let e = anchor_tx_commits(&tx(), TX, &other).unwrap_err();
    assert_eq!(e, "The transaction doesn't call payroll_audit_log.aleo/anchor_event with this root");
    // And by the anchor: nothing is anchored under it.
    let other_hex: String = other.iter().map(|b| format!("{b:02x}")).collect();
    let report = verify_public(&other_hex, "2026-10-31", Some(TX), &explorer(tx()));
    assert!(!report.passed());
    assert_eq!(report.checks.last().unwrap().label, ANCHORED);
}

#[test]
fn a_future_rewritten_to_name_another_root_is_refused() {
    // The explorer shows a different argument: the future's output id no longer recomputes.
    let mut t = tx();
    let value = t["execution"]["transitions"][0]["outputs"][0]["value"]
        .as_str()
        .unwrap()
        .replace("  149u8,", "  148u8,");
    t["execution"]["transitions"][0]["outputs"][0]["value"] = json!(value);
    let mut other = root();
    other[0] = 148;
    assert_eq!(
        anchor_tx_commits(&t, TX, &other).unwrap_err(),
        "The future naming this root doesn't recompute to its output id"
    );
}

#[test]
fn a_changed_transition_or_fee_is_refused() {
    let mut t = tx();
    t["execution"]["transitions"][0]["tcm"] = json!("1field");
    assert_eq!(
        anchor_tx_commits(&t, TX, &root()).unwrap_err(),
        format!("Transition {TRANSITION} doesn't recompute to its id")
    );

    let mut t = tx();
    t["execution"]["transitions"][0]["inputs"][0]["type"] = json!("public");
    assert!(
        anchor_tx_commits(&t, TX, &root())
            .unwrap_err()
            .contains("doesn't recompute to its id")
    );

    let mut t = tx();
    t["fee"]["transition"]["outputs"][0]["id"] = json!("2field");
    assert_eq!(
        anchor_tx_commits(&t, TX, &root()).unwrap_err(),
        "The fee's transition doesn't recompute to its id"
    );

    // Without its fee the transaction's tree has another root.
    let mut t = tx();
    t.as_object_mut().unwrap().remove("fee");
    assert_eq!(
        anchor_tx_commits(&t, TX, &root()).unwrap_err(),
        "The transaction doesn't recompute to its id"
    );
}

#[test]
fn another_transactions_id_is_refused() {
    let other = "at1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7fymfh";
    assert!(is_transaction_id(other));
    assert_eq!(
        anchor_tx_commits(&tx(), other, &root()).unwrap_err(),
        "The explorer sent another transaction"
    );
    let mut t = tx();
    t["id"] = json!(other);
    assert_eq!(
        anchor_tx_commits(&t, other, &root()).unwrap_err(),
        "The transaction doesn't recompute to its id"
    );
    assert!(!is_transaction_id("at1hg2etspa7udc6nj6yja2uc7p9fnf49l9973jvh9467w277mpx5rqp500eQ"));
    assert!(!is_transaction_id("at1hg2etspa7udc6nj6yja2uc7p9fnf49l9973jvh9467w277mpx5rqp500er"));
}

#[test]
fn a_block_from_before_the_range_ended_is_refused() {
    let table = explorer(tx()).json(
        &format!("/block/{HEIGHT}"),
        json!({ "header": { "metadata": { "timestamp": 1_761_000_000 } } }),
    );
    let report = verify_public(ROOT, "2026-10-31", Some(TX), &table);
    assert!(!report.checks.iter().find(|c| c.label == AFTER).unwrap().ok);
}

#[test]
#[ignore = "reads the live testnet explorer"]
fn live_october_is_anchored() {
    let report = verify_public(ROOT, "2026-10-31", Some(TX), &HttpExplorer::default_endpoint());
    println!("{}", report.text());
    assert!(report.passed());
    assert!(report.checks.iter().any(|c| c.detail == "In block 21,235,519"));
}
