//! Public reads from the Aleo explorer, the same three the website's `/verify` makes
//! (`apps/business/src/chain/period_check.ts`) and the one `scripts/release/lib.mjs` makes: the
//! `audit_event_height` entry for a hash, the block it names, and a transaction by id. Nothing is
//! sent but the hash (public once anchored) and transaction ids (public on chain). Nothing here
//! signs or sends a transaction: anchoring is done in Shield (INV-11).

use std::time::Duration;

use serde_json::Value;

use crate::generated::config;
use crate::release::{decode_hex, is_hex64};

/// Where releases and closed periods are anchored (@pnw/config).
pub const AUDIT_LOG_PROGRAM: &str = config::programs::layer1::PAYROLL_AUDIT_LOG;
/// The mapping `anchor_event` writes: hash → the block it first appeared in. @pnw/config has no
/// mapping or function names yet; the app writes these two in `chain/close_anchor.ts` and
/// `chain/period_check.ts`, and `scripts/release/lib.mjs` the same, so they live here once.
pub const AUDIT_EVENT_HEIGHT: &str = "audit_event_height";
/// The function that anchors a hash.
pub const ANCHOR_EVENT: &str = "anchor_event";

/// What an explorer answered.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    /// 404: no such entry, block or transaction.
    NotFound,
    /// 2xx, with its JSON body.
    Json(Value),
}

/// A failed read: the status the explorer answered, or why there was no answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    Status(u16),
    Other(String),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::Status(code) => write!(f, "The explorer answered {code}"),
            ReadError::Other(why) => write!(f, "The explorer couldn't be read: {why}"),
        }
    }
}

/// Something that answers explorer paths (`/program/…`, `/block/…`, `/transaction/…`).
pub trait Explorer {
    fn get(&self, path: &str) -> Result<Answer, ReadError>;
}

/// The explorer over HTTPS. Read only, 15 seconds a request, JSON only.
pub struct HttpExplorer {
    base: String,
    agent: ureq::Agent,
}

impl HttpExplorer {
    /// The explorer @pnw/config names.
    pub fn default_endpoint() -> Self {
        Self::new(config::ALEO_ENDPOINT)
    }

    pub fn new(endpoint: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .http_status_as_error(false)
            .https_only(true)
            .build()
            .into();
        Self {
            base: endpoint.trim_end_matches('/').to_string(),
            agent,
        }
    }

    pub fn endpoint(&self) -> &str {
        &self.base
    }
}

impl Explorer for HttpExplorer {
    fn get(&self, path: &str) -> Result<Answer, ReadError> {
        let url = format!("{}{}", self.base, path);
        let mut res = self
            .agent
            .get(&url)
            .header("Accept", "application/json")
            .call()
            .map_err(|e| ReadError::Other(e.to_string()))?;
        let status = res.status().as_u16();
        if status == 404 {
            return Ok(Answer::NotFound);
        }
        if !(200..300).contains(&status) {
            return Err(ReadError::Status(status));
        }
        let body = res.body_mut().read_to_string().map_err(|e| ReadError::Other(e.to_string()))?;
        serde_json::from_str(&body)
            .map(Answer::Json)
            .map_err(|_| ReadError::Other("the answer isn't JSON".into()))
    }
}

/// A 32-byte hash as the mapping's key, `[149u8,73u8,…]`, URL-encoded for the explorer's path,
/// exactly as the app (`rootKey`) and `lib.mjs` (`mappingKey`) write it.
pub fn mapping_key(hash: &str) -> Option<String> {
    if !is_hex64(hash) {
        return None;
    }
    let bytes = decode_hex(hash)?;
    let literal: Vec<String> = bytes.iter().map(|b| format!("{b}u8")).collect();
    Some(format!("%5B{}%5D", literal.join("%2C")))
}

/// JavaScript's `\s`: what `/^\s*(\d+)u32\s*$/` skips around the value.
pub(crate) fn js_space(c: char) -> bool {
    matches!(c, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// The block a hash was anchored at, or None when it never was. Read only.
pub fn anchor_height(explorer: &dyn Explorer, hash: &str) -> Result<Option<u64>, String> {
    let key = mapping_key(hash).ok_or("A period root is 64 hex characters")?;
    let path = format!("/program/{AUDIT_LOG_PROGRAM}/mapping/{AUDIT_EVENT_HEIGHT}/{key}");
    let value = match explorer.get(&path).map_err(|e| e.to_string())? {
        Answer::NotFound => return Ok(None),
        Answer::Json(v) => v,
    };
    let text = match value {
        Value::Null => return Ok(None),
        Value::String(s) => s,
        _ => return Err("The explorer sent the anchor in an unexpected shape".into()),
    };
    // `/^\s*(\d+)u32\s*$/`: spaces, digits, `u32`, spaces, and nothing else.
    let digits = text.trim_matches(js_space).strip_suffix("u32").unwrap_or("");
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err("The explorer sent the anchor in an unexpected shape".into());
    }
    let height: u64 = digits
        .parse()
        .map_err(|_| "The explorer sent the anchor in an unexpected shape".to_string())?;
    Ok(if height > 0 { Some(height) } else { None })
}

/// When a block was made, in seconds since 1970, or None when the explorer has no such block or
/// no time for it.
pub fn block_time(explorer: &dyn Explorer, height: u64) -> Result<Option<f64>, String> {
    match explorer.get(&format!("/block/{height}")).map_err(|e| e.to_string())? {
        Answer::NotFound => Ok(None),
        Answer::Json(v) => Ok(v.pointer("/header/metadata/timestamp").and_then(Value::as_f64)),
    }
}

/// Whether a transaction is on chain.
pub fn tx_exists(explorer: &dyn Explorer, id: &str) -> Result<bool, String> {
    match explorer.get(&format!("/transaction/{id}")).map_err(|e| e.to_string())? {
        Answer::NotFound => Ok(false),
        Answer::Json(_) => Ok(true),
    }
}

/// A transaction as the explorer serves it, or None when it has none by that id.
pub fn transaction(explorer: &dyn Explorer, id: &str) -> Result<Option<Value>, String> {
    match explorer.get(&format!("/transaction/{id}")).map_err(|e| e.to_string())? {
        Answer::NotFound => Ok(None),
        Answer::Json(v) => Ok(Some(v)),
    }
}

/// The UTC day (YYYY-MM-DD) of a time in seconds since 1970, as `toISOString().slice(0, 10)`.
pub fn utc_day(seconds: f64) -> String {
    let days = (seconds / 86_400.0).floor() as i64;
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_are_utc_days() {
        assert_eq!(utc_day(0.0), "1970-01-01");
        assert_eq!(utc_day(1_794_082_364.0), "2026-11-07");
        assert_eq!(utc_day(951_782_400.0), "2000-02-29");
        assert_eq!(utc_day(-1.0), "1969-12-31");
    }

    #[test]
    fn the_mapping_key_is_the_apps() {
        let key = mapping_key("95496641a8ea9ac3f9a99ecb33e7d172ba6d99efcd0e606dfdc8c2c6f904e68b").unwrap();
        assert!(key.starts_with("%5B149u8%2C73u8%2C102u8%2C"));
        assert!(key.ends_with("%2C230u8%2C139u8%5D"));
        assert_eq!(mapping_key("XYZ"), None);
    }
}
