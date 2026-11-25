//! A closed period's proof, checked as the website's `/verify` checks it: the file's half is
//! `@pnw/ledger`'s `readPeriodProof` and `checkPeriodProof` (packages/ledger/src/period_proof.ts,
//! period_root.ts, hash.ts), the chain's half `apps/business/src/chain/period_check.ts`
//! (docs/CLOSE_PERIOD.md, "The period proof"). The same rules byte for byte:
//!
//! - entry hash  = BLAKE3("PNW::GL::ENTRY::v1" ‖ 0x00 ‖ JSON.stringify(canonical array))
//! - H(domain, …fields) = BLAKE3(domain ‖ 0x00 ‖ for each field: u32 big-endian length ‖ bytes)
//! - entry leaf  = H("HEWN::LEAF::v1", salt, entry hash)
//! - settle leaf = H("HEWN::SETTLE::v1", settle salt, entry hash, tx id, H("HEWN::RECIPIENT::v1", entry salt, recipient))
//! - node        = H("HEWN::NODE::v1", left, right), an odd layer repeating its last node;
//!   empty tree  = H("HEWN::EMPTY::v1")
//! - root        = H("HEWN::PERIOD::v1", business tag, "start..end", n, m, prev root, chain head,
//!   entries root, settlements root)
//!
//! None of these are Aleo's hashes (BHP, Poseidon): the root is the app's own commitment, and the
//! chain only records it. What snarkVM adds natively is in `crate::aleo`.

use serde_json::Value;

use crate::chain::{self, Explorer};
use crate::js;
use crate::release::{decode_hex, is_hex64, thousands};
use crate::{Check, Report};

pub const PROOF_FORMAT: &str = "hewn-period-proof";
pub const ENTRY_DOMAIN: &str = "PNW::GL::ENTRY::v1";
pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// A file that isn't a period proof, with the sentence `readPeriodProof` says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofError(pub String);

impl std::fmt::Display for ProofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn bad<T>(message: impl Into<String>) -> Result<T, ProofError> {
    Err(ProofError(message.into()))
}

/// A proof file whose shape `readPeriodProof` accepts. The JSON is kept as it was read, so
/// entries hash from exactly what the file holds.
#[derive(Debug, Clone)]
pub struct PeriodProof {
    pub json: Value,
    pub business: Option<String>,
    pub start: String,
    pub end: String,
    pub root: String,
    pub prev_root: String,
    pub business_tag: String,
}

impl PeriodProof {
    pub fn entries(&self) -> &[Value] {
        self.json["entries"].as_array().map_or(&[], Vec::as_slice)
    }
    pub fn settlements(&self) -> &[Value] {
        self.json["settlements"].as_array().map_or(&[], Vec::as_slice)
    }
    pub fn closes(&self) -> &[Value] {
        self.json["closes"].as_array().map_or(&[], Vec::as_slice)
    }
}

fn is_date_shape(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn hex_field(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_str).is_some_and(is_hex64)
}

fn str_field(v: &Value, k: &str) -> bool {
    v.get(k).is_some_and(Value::is_string)
}

fn is_digits(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
}

/// `Number.isInteger`: a number with no fraction.
fn is_integer(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64).is_some_and(|x| x.is_finite() && x.fract() == 0.0)
}

/// `String(x)` for what an entry's id may be, in an error message.
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => js::number(n),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Null) => "null".into(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => "[object]".into(),
    }
}

/// Parses a proof file and checks its shape (`readPeriodProof`).
pub fn read_period_proof(text: &str) -> Result<PeriodProof, ProofError> {
    // A copy saved through a phone's share sheet is the same text; a BOM is not.
    let json: Value = serde_json::from_str(text).or_else(|_| bad("This file isn't a period proof: it isn't valid JSON"))?;
    if !json.is_object() || json.get("format").and_then(Value::as_str) != Some(PROOF_FORMAT) {
        return bad("This file isn't a period proof from this app");
    }
    if json.get("version").and_then(Value::as_f64) != Some(1.0) {
        return bad("This proof is from a newer version of the app");
    }
    let start = json.get("start").and_then(Value::as_str).filter(|s| is_date_shape(s));
    let end = json.get("end").and_then(Value::as_str).filter(|s| is_date_shape(s));
    let (Some(start), Some(end)) = (start, end) else {
        return bad("The proof's range is damaged");
    };
    if js::less(end, start) {
        return bad("The proof's range is damaged");
    }
    for k in ["root", "prevRoot", "businessTag"] {
        if !hex_field(&json, k) {
            return bad(format!("The proof's {k} is damaged"));
        }
    }
    if !["entries", "settlements", "closes", "accounts"]
        .iter()
        .all(|k| json.get(*k).is_some_and(Value::is_array))
    {
        return bad("The proof is missing its entries, settlements or closes");
    }
    for x in json["entries"].as_array().into_iter().flatten() {
        let ok = x.is_object()
            && hex_field(x, "hash")
            && hex_field(x, "prevHash")
            && hex_field(x, "salt")
            && is_integer(x.get("seq"))
            && str_field(x, "date")
            && x.get("lines").is_some_and(Value::is_array);
        if !ok {
            return bad("An entry in the proof is damaged");
        }
        for y in x["lines"].as_array().into_iter().flatten() {
            if !(y.is_object() && str_field(y, "accountId") && is_digits(y.get("debit")) && is_digits(y.get("credit"))) {
                return bad(format!("A line of entry {} is damaged", js_string(x.get("id"))));
            }
        }
    }
    for x in json["settlements"].as_array().into_iter().flatten() {
        let ok = x.is_object()
            && hex_field(x, "entryHash")
            && str_field(x, "txId")
            && str_field(x, "recipient")
            && hex_field(x, "entrySalt")
            && hex_field(x, "settleSalt");
        if !ok {
            return bad("A settlement in the proof is damaged");
        }
    }
    for x in json["closes"].as_array().into_iter().flatten() {
        if !(x.is_object() && hex_field(x, "root") && str_field(x, "start") && str_field(x, "end") && str_field(x, "closedAt")) {
            return bad("A close in the proof is damaged");
        }
    }
    let s = |k: &str| json[k].as_str().unwrap_or_default().to_string();
    Ok(PeriodProof {
        business: json.get("business").and_then(Value::as_str).map(str::to_string),
        start: start.to_string(),
        end: end.to_string(),
        root: s("root"),
        prev_root: s("prevRoot"),
        business_tag: s("businessTag"),
        json,
    })
}

/// `assertDate`: a real calendar day, YYYY-MM-DD.
pub fn assert_date(date: &str) -> Result<(), ProofError> {
    if !is_date_shape(date) {
        return bad(format!("Not a date (YYYY-MM-DD): \"{date}\""));
    }
    let (y, m, d): (i64, i64, i64) = (
        date[0..4].parse().unwrap_or(0),
        date[5..7].parse().unwrap_or(0),
        date[8..10].parse().unwrap_or(0),
    );
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    // JavaScript's Date takes years 0 to 99 as 1900 to 1999, which changes only February 29th of
    // year 0 (1900 has none): "0000-02-29" is no date there either.
    let js_leap_quirk = y == 0 && m == 2 && d == 29;
    if d < 1 || d > days || js_leap_quirk {
        return bad(format!("No such date: \"{date}\""));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The hashes (packages/ledger/src/hash.ts and period_root.ts).
// ---------------------------------------------------------------------------

/// A property as JavaScript reads it from a value: absent, or not an object, gives undefined.
fn prop<'a>(v: Option<&'a Value>, k: &str) -> Option<&'a Value> {
    v.and_then(Value::as_object).and_then(|o| o.get(k))
}

/// One element of the canonical array: `undefined` and `null` both print as `null`.
fn el(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => "null".into(),
        Some(v) => js::stringify(v),
    }
}

/// `BigInt(digits).toString()`: the digits without leading zeros.
fn cents(v: Option<&Value>) -> String {
    let s = v.and_then(Value::as_str).unwrap_or("0");
    let t = s.trim_start_matches('0');
    js::string(if t.is_empty() { "0" } else { t })
}

/// `canonicalEntry` of an entry as the proof holds it, or None where JavaScript would throw.
pub fn canonical_entry(entry: &Value) -> Option<String> {
    let source = entry.get("source");
    // `entry.source.doc` throws on null or undefined; any other value reads its properties.
    if matches!(source, None | Some(Value::Null)) {
        return None;
    }
    let doc = prop(source, "doc");
    let lines = entry.get("lines")?.as_array()?;
    let mut parts = vec![
        if doc.is_none() { "1".into() } else { "2".into() },
        el(entry.get("seq")),
        el(entry.get("id")),
        el(entry.get("date")),
        el(entry.get("memo")),
        el(prop(source, "kind")),
        el(prop(source, "ref")),
        el(entry.get("postedAt")),
        el(entry.get("reverses")),
        el(entry.get("replaces")),
        el(entry.get("prevHash")),
    ];
    let mut out_lines = Vec::new();
    for l in lines {
        let name = l.get("name");
        let tags = l.get("tags");
        let line = [
            el(l.get("accountId")),
            cents(l.get("debit")),
            cents(l.get("credit")),
            el(l.get("memo")),
            el(prop(name, "kind")),
            el(prop(name, "id")),
            el(prop(tags, "class")),
            el(prop(tags, "location")),
            el(prop(tags, "project")),
        ];
        out_lines.push(format!("[{}]", line.join(",")));
    }
    parts.push(format!("[{}]", out_lines.join(",")));
    if let Some(doc) = doc {
        parts.push(el(Some(doc)));
    }
    Some(format!("[{}]", parts.join(",")))
}

/// An entry's hash from its contents (`hashEntry`), or None where JavaScript would throw.
pub fn hash_entry(entry: &Value) -> Option<String> {
    let body = canonical_entry(entry)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(ENTRY_DOMAIN.as_bytes());
    hasher.update(&[0]);
    hasher.update(body.as_bytes());
    Some(hasher.finalize().to_hex().to_string())
}

/// H(domain, …fields).
pub fn h(domain: &str, fields: &[&[u8]]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    for f in fields {
        hasher.update(&(f.len() as u32).to_be_bytes());
        hasher.update(f);
    }
    *hasher.finalize().as_bytes()
}

fn bytes32(hex: &str, what: &str) -> Result<[u8; 32], String> {
    if !is_hex64(hex) {
        return Err(format!("{what} must be 64 lower-case hex characters"));
    }
    let v = decode_hex(hex).ok_or(format!("{what} must be 64 lower-case hex characters"))?;
    v.try_into().map_err(|_| format!("{what} must be 64 lower-case hex characters"))
}

pub fn entry_leaf(salt: &str, entry_hash: &str) -> Result<[u8; 32], String> {
    Ok(h(
        "HEWN::LEAF::v1",
        &[&bytes32(salt, "An entry's salt")?, &bytes32(entry_hash, "An entry hash")?],
    ))
}

pub fn settlement_leaf(s: &Value) -> Result<[u8; 32], String> {
    let text = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or_default();
    let entry = bytes32(text("entryHash"), "A settlement's entry hash")?;
    let tx = text("txId");
    let recipient = text("recipient");
    if js::blank(tx) {
        return Err("A settlement needs its transaction id".into());
    }
    if js::blank(recipient) {
        return Err("A settlement needs its recipient".into());
    }
    let tag = h(
        "HEWN::RECIPIENT::v1",
        &[&bytes32(text("entrySalt"), "A settlement's entry salt")?, recipient.as_bytes()],
    );
    Ok(h(
        "HEWN::SETTLE::v1",
        &[&bytes32(text("settleSalt"), "A settlement's salt")?, &entry, tx.as_bytes(), &tag],
    ))
}

/// The root of a list of leaves.
pub fn merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return h("HEWN::EMPTY::v1", &[]);
    }
    let mut layer = leaves.to_vec();
    while layer.len() > 1 {
        layer = layer
            .chunks(2)
            .map(|pair| h("HEWN::NODE::v1", &[&pair[0], pair.get(1).unwrap_or(&pair[0])]))
            .collect();
    }
    layer[0]
}

/// Everything the root commits to besides the leaves.
pub struct RootParts<'a> {
    pub business_tag: &'a str,
    pub period_id: &'a str,
    pub n: u32,
    pub m: u32,
    pub prev_root: &'a str,
    pub chain_head: &'a str,
    pub entries_root: [u8; 32],
    pub settlements_root: [u8; 32],
}

pub fn root_from_parts(p: &RootParts) -> Result<[u8; 32], String> {
    Ok(h(
        "HEWN::PERIOD::v1",
        &[
            &bytes32(p.business_tag, "The business tag")?,
            p.period_id.as_bytes(),
            &p.n.to_be_bytes(),
            &p.m.to_be_bytes(),
            &bytes32(p.prev_root, "The previous root")?,
            &bytes32(p.chain_head, "The chain head")?,
            &p.entries_root,
            &p.settlements_root,
        ],
    ))
}

// ---------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------

/// What the file's half found: the recomputed root when every check passes.
#[derive(Debug, Clone)]
pub struct OfflineResult {
    pub root: Option<String>,
    pub checks: Vec<Check>,
    pub entries: usize,
    pub payments: usize,
}

/// The offline checks of a period proof (`checkPeriodProof`).
pub fn check_period_proof(proof: &PeriodProof) -> Result<OfflineResult, ProofError> {
    assert_date(&proof.start)?;
    assert_date(&proof.end)?;
    let entries = proof.entries();
    let mut checks = Vec::new();

    let altered: Vec<&Value> = entries
        .iter()
        .filter(|e| hash_entry(e).as_deref() != e.get("hash").and_then(Value::as_str))
        .collect();
    const ENTRIES: &str = "Every entry is exactly as it was posted";
    if altered.is_empty() {
        checks.push(Check::pass(ENTRIES, ""));
    } else {
        let n = altered.len();
        let what = if n == 1 {
            "1 entry doesn't hash to its recorded hash".to_string()
        } else {
            format!("{n} entries don't hash to their recorded hashes")
        };
        checks.push(Check::fail(ENTRIES, format!("{what} (first: {})", js_string(altered[0].get("id")))));
    }

    let date = |e: &Value| e.get("date").and_then(Value::as_str).unwrap_or_default().to_string();
    let outside: Vec<&Value> = entries
        .iter()
        .filter(|e| js::less(&date(e), &proof.start) || js::less(&proof.end, &date(e)))
        .collect();
    const RANGE: &str = "Every entry is dated in the range";
    if outside.is_empty() {
        checks.push(Check::pass(RANGE, ""));
    } else {
        checks.push(Check::fail(
            RANGE,
            format!(
                "{} dated outside the range (first: {}, {})",
                outside.len(),
                js_string(outside[0].get("id")),
                date(outside[0])
            ),
        ));
    }

    let seq = |e: &Value| e.get("seq").and_then(Value::as_f64).unwrap_or(f64::NAN);
    let ordered = entries.windows(2).all(|w| seq(&w[1]) > seq(&w[0]));
    const ORDER: &str = "The entries are in journal order, each once";
    checks.push(if ordered {
        Check::pass(ORDER, "")
    } else {
        Check::fail(ORDER, "An entry is out of order or repeated")
    });

    let recompute = || -> Result<String, String> {
        let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        let leaves = entries
            .iter()
            .map(|e| entry_leaf(&text(e, "salt"), &text(e, "hash")))
            .collect::<Result<Vec<_>, _>>()?;
        let settles = proof.settlements().iter().map(settlement_leaf).collect::<Result<Vec<_>, _>>()?;
        let head = entries.last().map(|e| text(e, "hash")).unwrap_or_else(|| GENESIS_HASH.to_string());
        let period_id = format!("{}..{}", proof.start, proof.end);
        let root = root_from_parts(&RootParts {
            business_tag: &proof.business_tag,
            period_id: &period_id,
            n: u32::try_from(leaves.len()).map_err(|_| "Too many entries")?,
            m: u32::try_from(settles.len()).map_err(|_| "Too many payments")?,
            prev_root: &proof.prev_root,
            chain_head: &head,
            entries_root: merkle_root(&leaves),
            settlements_root: merkle_root(&settles),
        })?;
        Ok(crate::release::hex(&root))
    };
    let (recomputed, root_detail) = match recompute() {
        Ok(r) if r == proof.root => (Some(r), None),
        Ok(r) => (
            Some(r),
            Some("The entries and payments give a different root: something was added, removed or changed".to_string()),
        ),
        Err(e) => (None, Some(e)),
    };
    let offline_ok = checks.iter().all(|c| c.ok) && root_detail.is_none();
    const ROOT: &str = "Everything recomputes to the period's root";
    checks.push(match &root_detail {
        None => Check::pass(ROOT, proof.root.clone()),
        Some(d) => Check::fail(ROOT, d.clone()),
    });
    Ok(OfflineResult {
        root: if offline_ok { recomputed } else { None },
        checks,
        entries: entries.len(),
        payments: proof.settlements().len(),
    })
}

/// The anchor is looked up by its root alone: `anchor_event` records no caller.
pub const ANCHORED: &str = "The root is anchored on Aleo (by an account this verifier doesn't check)";
pub const AFTER: &str = "It was anchored after the range ended";
pub const COMMITS: &str = "The anchoring transaction carries this root (recomputed with snarkVM)";

/// `/verify`'s transaction id pattern: `at1` and 58 bech32 characters.
fn tx_shape(id: &str) -> bool {
    id.len() == 61
        && id.starts_with("at1")
        && id[3..]
            .bytes()
            .all(|b| matches!(b, b'0' | b'2'..=b'9' | b'a'..=b'h' | b'j'..=b'n' | b'p'..=b'z') && b != b'b' && b != b'i' && b != b'o')
}

/// The chain checks of a range whose offline checks passed (`chainChecks`), plus, when the
/// transaction that anchored it is known, the native check that it carries this root.
pub fn chain_checks(end: &str, settlement_txs: &[String], root: &str, anchor_tx: Option<&str>, explorer: &dyn Explorer) -> Vec<Check> {
    let mut out = Vec::new();
    let height = match chain::anchor_height(explorer, root) {
        Ok(Some(h)) => h,
        Ok(None) => {
            out.push(Check::fail(
                ANCHORED,
                "No anchor for this root: it was never put on chain, or the range was closed again with a different root",
            ));
            return out;
        }
        Err(e) => {
            out.push(Check::fail(ANCHORED, format!("Couldn't read the network: {e}")));
            return out;
        }
    };
    out.push(Check::pass(ANCHORED, format!("In block {}", thousands(height))));
    match chain::block_time(explorer, height) {
        Ok(Some(seconds)) => {
            let day = chain::utc_day(seconds);
            let after = js::less(end, &day);
            let detail = if after {
                format!("On {day}, after {end}")
            } else {
                format!("On {day}, before the range ended on {end}")
            };
            out.push(if after {
                Check::pass(AFTER, detail)
            } else {
                Check::fail(AFTER, detail)
            });
        }
        Ok(None) => out.push(Check::fail(AFTER, "The network didn't return that block's time")),
        Err(e) => out.push(Check::fail(AFTER, format!("Couldn't read the network: {e}"))),
    }
    if !settlement_txs.is_empty() {
        let label = format!("Every payment's transaction is on chain ({})", settlement_txs.len());
        // Stricter than /verify: an id must also be one snarkVM reads, checksum and all.
        let odd = settlement_txs
            .iter()
            .filter(|id| !tx_shape(id) || !crate::aleo::is_transaction_id(id))
            .count();
        let mut missing = Vec::new();
        let mut failure = None;
        for id in settlement_txs
            .iter()
            .filter(|id| tx_shape(id) && crate::aleo::is_transaction_id(id))
        {
            match chain::tx_exists(explorer, id) {
                Ok(true) => {}
                Ok(false) => missing.push(id.clone()),
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
        }
        if let Some(e) = failure {
            out.push(Check::fail(label, format!("Couldn't read the network: {e}")));
        } else if missing.is_empty() && odd == 0 {
            out.push(Check::pass(label, ""));
        } else {
            let mut parts = Vec::new();
            if !missing.is_empty() {
                parts.push(format!("{} not found (first: {})", missing.len(), missing[0]));
            }
            if odd > 0 {
                parts.push(format!("{odd} not a transaction id"));
            }
            out.push(Check::fail(label, parts.join("; ")));
        }
    }
    if let Some(tx) = anchor_tx {
        out.push(anchor_tx_check(tx, root, explorer));
    }
    out
}

/// The native check: the named transaction recomputes to its id and carries `root`.
pub fn anchor_tx_check(tx: &str, root: &str, explorer: &dyn Explorer) -> Check {
    let Some(bytes) = decode_hex(root).and_then(|v| <[u8; 32]>::try_from(v).ok()) else {
        return Check::fail(COMMITS, "A period root is 64 hex characters");
    };
    if !crate::aleo::is_transaction_id(tx) {
        return Check::fail(COMMITS, format!("{tx} isn't a transaction id"));
    }
    match chain::transaction(explorer, tx) {
        Ok(Some(json)) => match crate::aleo::anchor_tx_commits(&json, tx, &bytes) {
            Ok(found) => Check::pass(
                COMMITS,
                format!(
                    "{} (transition {}): its future's output id, its transitions' ids and its own id all recompute",
                    found.transaction, found.transition
                ),
            ),
            Err(e) => Check::fail(COMMITS, format!("{tx}: {e}")),
        },
        Ok(None) => Check::fail(COMMITS, format!("The network has no transaction {tx}")),
        Err(e) => Check::fail(COMMITS, format!("Couldn't read the network: {e}")),
    }
}

/// The transaction that anchored the standing close of this root, as the proof's closes record
/// it: the newest close with this root that wasn't reopened.
pub fn anchor_tx_of(proof: &PeriodProof, root: &str) -> Option<String> {
    proof
        .closes()
        .iter()
        .find(|c| c.get("root").and_then(Value::as_str) == Some(root) && c.get("reopenedAt").is_none_or(Value::is_null))
        .and_then(|c| c.get("anchorTx").and_then(Value::as_str))
        .map(str::to_string)
}

/// Checks a period proof file end to end: the file's half, then, if it passes and an explorer is
/// given, the chain's half.
pub fn verify_proof(text: &str, explorer: Option<&dyn Explorer>) -> Report {
    let mut report = Report::new("Period proof".to_string());
    const READ: &str = "The file is a period proof";
    let proof = match read_period_proof(text) {
        Ok(p) => p,
        Err(e) => {
            report.push(Check::fail(READ, e.0));
            return report;
        }
    };
    let business = proof
        .business
        .as_deref()
        .map(|b| format!("{b} (as the file says; not checked), "))
        .unwrap_or_default();
    report.title = format!("Period proof: {}{} to {}", business, proof.start, proof.end);
    let offline = match check_period_proof(&proof) {
        Ok(r) => r,
        Err(e) => {
            report.push(Check::fail(READ, e.0));
            return report;
        }
    };
    report.push(Check::pass(
        READ,
        format!("{} entries, {} payments", offline.entries, offline.payments),
    ));
    for c in offline.checks {
        report.push(c);
    }
    let (Some(root), Some(explorer)) = (offline.root, explorer) else {
        return report;
    };
    let txs: Vec<String> = proof
        .settlements()
        .iter()
        .map(|s| s.get("txId").and_then(Value::as_str).unwrap_or_default().to_string())
        .collect();
    let anchor_tx = anchor_tx_of(&proof, &root);
    for c in chain_checks(&proof.end, &txs, &root, anchor_tx.as_deref(), explorer) {
        report.push(c);
    }
    report
}

/// Checks a period by its public data alone: a root that the person has (from the close's record
/// in the books, a proof or the progress log), the range's last day and, optionally, the
/// transaction that anchored it. No file: the entries can't be checked, only the anchor.
pub fn verify_public(root: &str, end: &str, anchor_tx: Option<&str>, explorer: &dyn Explorer) -> Report {
    let mut report = Report::new(format!("Period ending {end}: root {root}"));
    const GIVEN: &str = "The root and the range's end are well formed";
    if !is_hex64(root) {
        report.push(Check::fail(GIVEN, "A period root is 64 lower-case hex characters"));
        return report;
    }
    if let Err(e) = assert_date(end) {
        report.push(Check::fail(GIVEN, e.0));
        return report;
    }
    report.push(Check::pass(
        GIVEN,
        "Without the proof file the entries aren't checked: only the anchor",
    ));
    for c in chain_checks(end, &[], root, anchor_tx, explorer) {
        report.push(c);
    }
    report
}
