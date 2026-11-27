//! The native verifier: checks a signed release and a closed period's proof and anchor, with no
//! web engine, no wallet and no keys (apps/native/README.md). Every rule here is the one the
//! JavaScript tools apply, byte for byte; the tests run both against the same fixtures.
//!
//! - [`release`]: a release folder, as `scripts/release/verify.mjs` checks it.
//! - [`period`]: a period proof, as the website's `/verify` checks it.
//! - [`chain`]: the explorer reads both make, read only.
//! - [`aleo`]: what snarkVM adds natively: transaction ids, and that the anchoring transaction
//!   carries the root.
//!
//! Nothing in this crate signs or sends a transaction (INV-11).

pub mod aleo;
pub mod chain;
#[rustfmt::skip]
pub mod generated;
pub mod js;
pub mod period;
pub mod release;

/// One check, passed or failed, with why, in words a person reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

impl Check {
    pub fn pass(label: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            ok: true,
            detail: detail.into(),
        }
    }
    pub fn fail(label: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            ok: false,
            detail: detail.into(),
        }
    }
}

/// Every check of one thing checked, in the order a person reads them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub title: String,
    pub checks: Vec<Check>,
}

impl Report {
    pub fn new(title: String) -> Self {
        Self { title, checks: Vec::new() }
    }
    pub fn push(&mut self, check: Check) {
        self.checks.push(check);
    }
    /// Whether every check passed (and there was at least one).
    pub fn passed(&self) -> bool {
        !self.checks.is_empty() && self.checks.iter().all(|c| c.ok)
    }
    /// The report as plain lines, for a terminal.
    pub fn text(&self) -> String {
        let mut out = format!("{}\n", self.title);
        for c in &self.checks {
            let mark = if c.ok { "PASS" } else { "FAIL" };
            out.push_str(&format!("  {mark}  {}", c.label));
            if !c.detail.is_empty() {
                out.push_str(&format!(": {}", c.detail));
            }
            out.push('\n');
        }
        out.push_str(if self.passed() { "VERIFIED\n" } else { "NOT VERIFIED\n" });
        out
    }
}
