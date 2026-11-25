//! The period checks against proofs @pnw/ledger made (tests/fixtures, written by
//! scripts/period_fixture.test.ts), and the ways a proof must fail.

mod common;

use common::*;
use pnw_verify::period::*;
use serde_json::{Value, json};

const ROOT: &str = "99fbe4adedb5bbdda67ae58ad4a23dcfdf4eb7c58deff21d44835e8a1a391ab7";
const TX1: &str = "at1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7fymfh";
const TX2: &str = "at1qgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5ragwl";

fn text() -> String {
    std::fs::read_to_string(fixture("period_proof.json")).unwrap()
}

fn json() -> Value {
    serde_json::from_str(&text()).unwrap()
}

fn failing(v: &Value) -> Vec<String> {
    let proof = read_period_proof(&v.to_string()).unwrap();
    check_period_proof(&proof)
        .unwrap()
        .checks
        .into_iter()
        .filter(|c| !c.ok)
        .map(|c| format!("{}: {}", c.label, c.detail))
        .collect()
}

#[test]
fn the_ledgers_proof_recomputes_to_its_root() {
    let proof = read_period_proof(&text()).unwrap();
    let r = check_period_proof(&proof).unwrap();
    assert!(r.checks.iter().all(|c| c.ok), "{:?}", r.checks);
    assert_eq!(r.root.as_deref(), Some(ROOT));
    assert_eq!((r.entries, r.payments), (4, 2));
}

#[test]
fn every_entry_hashes_as_the_ledger_hashed_it() {
    for e in json()["entries"].as_array().unwrap() {
        assert_eq!(hash_entry(e).as_deref(), e["hash"].as_str(), "entry {}", e["id"]);
    }
}

#[test]
fn an_empty_range_has_its_fixed_root() {
    let text = std::fs::read_to_string(fixture("period_proof_empty.json")).unwrap();
    let r = check_period_proof(&read_period_proof(&text).unwrap()).unwrap();
    assert_eq!(
        r.root.as_deref(),
        Some("9f88b285fde5e4ac508280470290bc94ad5fe657b843e8a3d9cb4cbd2a90cb8f")
    );
}

#[test]
fn amounts_read_as_bigint_reads_them() {
    // BigInt("0120000") is 120000: leading zeros don't change the hash, as in JavaScript.
    let mut v = json();
    v["entries"][0]["lines"][0]["debit"] = json!("0120000");
    assert!(failing(&v).is_empty());
}

#[test]
fn a_changed_entry_is_refused() {
    let mut v = json();
    v["entries"][0]["memo"] = json!("Rent, on time");
    assert_eq!(
        failing(&v),
        vec!["Every entry is exactly as it was posted: 1 entry doesn't hash to its recorded hash (first: e-1)"]
    );
    let mut v = json();
    v["entries"][1]["lines"][0]["debit"] = json!("250001");
    assert!(failing(&v)[0].starts_with("Every entry is exactly as it was posted"));
    let mut v = json();
    v["entries"][1]["source"].as_object_mut().unwrap().remove("doc");
    assert!(failing(&v)[0].starts_with("Every entry is exactly as it was posted"));
}

#[test]
fn a_removed_entry_gives_a_different_root() {
    let mut v = json();
    v["entries"].as_array_mut().unwrap().remove(2);
    assert_eq!(
        failing(&v),
        vec![
            "Everything recomputes to the period's root: The entries and payments give a different root: something was added, removed or changed"
        ]
    );
}

#[test]
fn a_removed_payment_gives_a_different_root() {
    let mut v = json();
    v["settlements"].as_array_mut().unwrap().pop();
    assert_eq!(failing(&v).len(), 1);
}

#[test]
fn a_wrong_root_is_refused() {
    let mut v = json();
    v["root"] = json!("ab".repeat(32));
    let proof = read_period_proof(&v.to_string()).unwrap();
    let r = check_period_proof(&proof).unwrap();
    assert_eq!(r.root, None);
    assert_eq!(
        r.checks.last().unwrap().detail,
        "The entries and payments give a different root: something was added, removed or changed"
    );
    // And the chain is never asked about it.
    let table = Table::default();
    let report = verify_proof(&v.to_string(), Some(&table));
    assert!(!report.passed());
    assert!(table.asked.borrow().is_empty());
}

#[test]
fn a_different_previous_root_or_tag_is_refused() {
    for k in ["prevRoot", "businessTag"] {
        let mut v = json();
        v[k] = json!("00".repeat(32));
        assert_eq!(failing(&v).len(), 1, "{k}");
    }
}

#[test]
fn an_entry_outside_the_range_or_out_of_order_is_refused() {
    let mut v = json();
    v["end"] = json!("2026-10-30");
    let f = failing(&v);
    assert!(
        f.iter()
            .any(|x| x == "Every entry is dated in the range: 1 dated outside the range (first: e-4, 2026-10-31)"),
        "{f:?}"
    );
    let mut v = json();
    v["entries"].as_array_mut().unwrap().swap(0, 1);
    assert!(failing(&v).iter().any(|x| x.starts_with("The entries are in journal order")));
}

#[test]
fn a_blank_recipient_is_refused() {
    let mut v = json();
    v["settlements"][0]["recipient"] = json!(" \u{feff} ");
    assert_eq!(
        failing(&v),
        vec!["Everything recomputes to the period's root: A settlement needs its recipient"]
    );
}

#[test]
fn what_isnt_a_proof_is_refused_with_the_apps_words() {
    let cases: Vec<(String, &str)> = vec![
        ("{".into(), "This file isn't a period proof: it isn't valid JSON"),
        (
            json!({"format": "other"}).to_string(),
            "This file isn't a period proof from this app",
        ),
        (
            {
                let mut v = json();
                v["version"] = json!(2);
                v.to_string()
            },
            "This proof is from a newer version of the app",
        ),
        (
            {
                let mut v = json();
                v["start"] = json!("2026-11-01");
                v.to_string()
            },
            "The proof's range is damaged",
        ),
        (
            {
                let mut v = json();
                v["root"] = json!("AB".repeat(32));
                v.to_string()
            },
            "The proof's root is damaged",
        ),
        (
            {
                let mut v = json();
                v["entries"][0]["lines"][0]["credit"] = json!(5);
                v.to_string()
            },
            "A line of entry e-1 is damaged",
        ),
        (
            {
                let mut v = json();
                v["settlements"][0]["entrySalt"] = json!("x");
                v.to_string()
            },
            "A settlement in the proof is damaged",
        ),
    ];
    for (text, why) in cases {
        assert_eq!(read_period_proof(&text).unwrap_err().0, why);
    }
}

#[test]
fn a_date_that_doesnt_exist_is_refused() {
    let mut v = json();
    v["end"] = json!("2026-02-30");
    v["start"] = json!("2026-02-01");
    let proof = read_period_proof(&v.to_string()).unwrap();
    assert_eq!(check_period_proof(&proof).unwrap_err().0, "No such date: \"2026-02-30\"");
    assert!(assert_date("2024-02-29").is_ok());
    assert!(assert_date("2100-02-29").is_err());
}

fn chain(after: bool) -> Table {
    let time = if after { 1_794_082_364 } else { 1_761_000_000 }; // 2026-11-07, or 2025-10-20
    Table::default()
        .json(&anchor_path(ROOT), json!("21235519u32"))
        .json("/block/21235519", json!({ "header": { "metadata": { "timestamp": time } } }))
        .json(&format!("/transaction/{TX1}"), json!({ "type": "execute", "id": TX1 }))
        .json(&format!("/transaction/{TX2}"), json!({ "type": "execute", "id": TX2 }))
}

#[test]
fn the_chain_half_passes_when_anchored_after_the_range() {
    let table = chain(true);
    let report = verify_proof(&text(), Some(&table));
    let labels: Vec<(&str, bool)> = report.checks.iter().map(|c| (c.label.as_str(), c.ok)).collect();
    assert!(labels.contains(&(ANCHORED, true)), "{}", report.text());
    assert!(labels.contains(&(AFTER, true)));
    assert!(labels.contains(&("Every payment's transaction is on chain (2)", true)));
    // The standing close names TX1, which isn't really an anchor: the native check refuses it.
    let commits = report.checks.iter().find(|c| c.label == COMMITS).unwrap();
    assert!(!commits.ok);
    assert!(report.title.contains("Example Woodworks (as the file says; not checked)"));
}

#[test]
fn anchored_before_the_range_ended_fails() {
    let report = verify_proof(&text(), Some(&chain(false)));
    let after = report.checks.iter().find(|c| c.label == AFTER).unwrap();
    assert!(!after.ok);
    assert_eq!(after.detail, "On 2025-10-20, before the range ended on 2026-10-31");
}

#[test]
fn not_anchored_fails_and_stops() {
    let report = verify_proof(&text(), Some(&Table::default()));
    let last = report.checks.last().unwrap();
    assert_eq!((last.label.as_str(), last.ok), (ANCHORED, false));
}

#[test]
fn a_payment_that_isnt_a_transaction_or_isnt_on_chain_fails() {
    let table = chain(true);
    // A changed payment changes the root, so the chain half is never reached from a proof: the
    // payments' check is tested on its own.
    let malformed = format!("at1q{}", "q".repeat(57)); // the right shape, a wrong checksum
    let checks = chain_checks("2026-10-31", &[TX1.into(), "at1qsqq".into(), malformed], ROOT, None, &table);
    let payments = checks.iter().find(|c| c.label.starts_with("Every payment's")).unwrap();
    assert_eq!((payments.ok, payments.detail.as_str()), (false, "2 not a transaction id"));
    let unknown = "at1qvqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj9d75q";
    let checks = chain_checks("2026-10-31", &[TX1.into(), unknown.into()], ROOT, None, &table);
    let payments = checks.iter().find(|c| c.label.starts_with("Every payment's")).unwrap();
    assert_eq!(
        (payments.ok, payments.detail.clone()),
        (false, format!("1 not found (first: {unknown})"))
    );
}
