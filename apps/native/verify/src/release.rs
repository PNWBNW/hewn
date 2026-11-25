//! A release, checked as `scripts/release/verify.mjs` checks a bundle folder (its README has the
//! format). Byte for byte the same rules as `scripts/release/lib.mjs`:
//!
//! - `release.json` is well formed, every path is one a release may carry, and `digest` is the
//!   SHA-256 of the canonical JSON of `files` (`{"<path>":"<hash>",...}`, paths in byte order, no
//!   whitespace, UTF-8).
//! - `release.sig` is `{"key": "<16 hex>", "sig": "<base64>"}`, an Ed25519 signature over the 32
//!   raw digest bytes by one of the trusted keys (a key's id is the first 16 hex of the SHA-256
//!   of its raw 32-byte public key).
//! - Every file in the folder is listed with its SHA-256, and nothing else is there.
//! - The commit `release.json` names is the Next.js build id the signed list carries.
//! - Optionally, the digest is anchored on Aleo (`crate::chain`).
//!
//! Only a folder on disk is checked here; `verify.mjs` also checks a URL.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::chain::{self, Explorer};
use crate::generated::brand;
use crate::{Check, Report};

pub const MANIFEST: &str = "release.json";
pub const SIGNATURE: &str = "release.sig";

/// A problem a person should read; the message is the same sentence `lib.mjs` writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseError(pub String);

impl std::fmt::Display for ReleaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ReleaseError {}

fn err<T>(message: impl Into<String>) -> Result<T, ReleaseError> {
    Err(ReleaseError(message.into()))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_commit(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn is_key_id(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The canonical JSON of a files list: paths in byte order, no whitespace. Paths and hashes are
/// printable ASCII without `"` or `\`, so each is itself between quotes.
pub fn canonical_files(files: &BTreeMap<String, String>) -> String {
    let body: Vec<String> = files.iter().map(|(p, h)| format!("\"{p}\":\"{h}\"")).collect();
    format!("{{{}}}", body.join(","))
}

/// The release digest: SHA-256 of the canonical JSON of the files, as hex.
pub fn files_digest(files: &BTreeMap<String, String>) -> String {
    sha256_hex(canonical_files(files).as_bytes())
}

/// A path as release.json may name it: printable ASCII without `"` or `\`, relative, forward
/// slashes, no empty, `.` or `..` segment.
pub fn safe_path(path: &str) -> bool {
    if path.is_empty() || path.len() > 1024 || path.starts_with('/') {
        return false;
    }
    if !path.bytes().all(|b| (0x20..=0x7e).contains(&b) && b != b'"' && b != b'\\') {
        return false;
    }
    path.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

/// Every file under `dir` as bundle paths, sorted, without release.json and release.sig at the root.
pub fn bundle_files(dir: &Path) -> Result<Vec<String>, ReleaseError> {
    fn walk(root: &Path, d: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), ReleaseError> {
        let entries = fs::read_dir(d).map_err(|e| ReleaseError(format!("Couldn't read {}: {e}", d.display())))?;
        for entry in entries {
            let entry = entry.map_err(|e| ReleaseError(format!("Couldn't read {}: {e}", d.display())))?;
            let name = entry.file_name();
            let rel = match name.to_str() {
                Some(n) => format!("{prefix}{n}"),
                None => return err(format!("A file name a release can't carry: {}", entry.path().display())),
            };
            let kind = entry.file_type().map_err(|e| ReleaseError(format!("Couldn't read {rel}: {e}")))?;
            if kind.is_symlink() {
                return err(format!("The bundle holds a link, which a release can't: {rel}"));
            } else if kind.is_dir() {
                walk(root, &entry.path(), &format!("{rel}/"), out)?;
            } else if kind.is_file() {
                if rel != MANIFEST && rel != SIGNATURE {
                    out.push(rel);
                }
            } else {
                return err(format!("The bundle holds something that isn't a file: {rel}"));
            }
        }
        let _ = root;
        Ok(())
    }
    let is_dir = fs::symlink_metadata(dir).map(|m| m.is_dir()).unwrap_or(false);
    if !is_dir {
        return err(format!("No bundle at {}", dir.display()));
    }
    let mut out = Vec::new();
    walk(dir, dir, "", &mut out)?;
    for rel in &out {
        if !safe_path(rel) {
            return err(format!(
                "A file name a release can't carry: {}",
                serde_json::to_string(rel).unwrap_or_default()
            ));
        }
    }
    out.sort();
    Ok(out)
}

/// The files of a bundle directory: each path with its SHA-256.
pub fn hash_bundle(dir: &Path) -> Result<BTreeMap<String, String>, ReleaseError> {
    let mut files = BTreeMap::new();
    for rel in bundle_files(dir)? {
        let full = rel.split('/').fold(dir.to_path_buf(), |p, seg| p.join(seg));
        let bytes = fs::read(&full).map_err(|e| ReleaseError(format!("Couldn't read {rel}: {e}")))?;
        files.insert(rel, sha256_hex(&bytes));
    }
    Ok(files)
}

/// A parsed release.json.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub version: String,
    pub commit: String,
    pub created: String,
    pub files: BTreeMap<String, String>,
    pub digest: String,
}

/// Parses and checks a release.json: its shape, every path, and that the digest is the files'.
/// Stricter than `lib.mjs` in one way only: a field the format says is a string must be a JSON
/// string (JavaScript's regular expressions would also accept, say, a one-element array).
pub fn parse_manifest(text: &str) -> Result<Manifest, ReleaseError> {
    let m: Value = serde_json::from_str(text).or_else(|_| err("release.json isn't JSON"))?;
    let Some(obj) = m.as_object() else {
        return err("release.json isn't an object");
    };
    let s = |k: &str| obj.get(k).and_then(Value::as_str);
    let version = match s("version") {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => return err("release.json has no version"),
    };
    let commit = match s("commit") {
        Some(c) if is_commit(c) => c.to_string(),
        _ => return err("release.json's commit isn't 40 hex characters"),
    };
    let created = match s("created") {
        Some(d) if is_day(d) => d.to_string(),
        _ => return err("release.json's date isn't YYYY-MM-DD"),
    };
    let digest = match s("digest") {
        Some(d) if is_hex64(d) => d.to_string(),
        _ => return err("release.json's digest isn't 64 hex characters"),
    };
    let Some(list) = obj.get("files").and_then(Value::as_object) else {
        return err("release.json has no files");
    };
    if list.is_empty() {
        return err("release.json lists no files");
    }
    let mut files = BTreeMap::new();
    for (p, h) in list {
        if !safe_path(p) || p == MANIFEST || p == SIGNATURE {
            return err(format!(
                "release.json lists a path a release can't carry: {}",
                serde_json::to_string(p).unwrap_or_default()
            ));
        }
        match h.as_str() {
            Some(h) if is_hex64(h) => {
                files.insert(p.clone(), h.to_string());
            }
            _ => return err(format!("release.json's hash for {p} isn't 64 hex characters")),
        }
    }
    if files_digest(&files) != digest {
        return err("release.json's digest doesn't match its list of files");
    }
    Ok(Manifest {
        version,
        commit,
        created,
        files,
        digest,
    })
}

/// The Next.js build ids a list of files names (`_next/static/<id>/…`) that are 40-hex commits.
pub fn build_ids(files: &BTreeMap<String, String>) -> Vec<String> {
    let mut ids: Vec<String> = files
        .keys()
        .filter_map(|p| p.strip_prefix("_next/static/"))
        .filter_map(|rest| rest.split_once('/'))
        .filter(|(id, _)| is_commit(id))
        .map(|(id, _)| id.to_string())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// A key's id: the first 16 hex characters of the SHA-256 of its raw 32-byte public key.
pub fn key_id(raw: &[u8; 32]) -> String {
    sha256_hex(raw)[..16].to_string()
}

/// A public key from base64 raw 32 bytes (canonical base64 only, as `lib.mjs` requires).
pub fn public_key_from_base64(b64: &str) -> Result<([u8; 32], VerifyingKey), ReleaseError> {
    let bad = || ReleaseError("A release public key is 32 bytes in base64".into());
    let raw = B64.decode(b64).map_err(|_| bad())?;
    if raw.len() != 32 || B64.encode(&raw) != b64 {
        return Err(bad());
    }
    let raw: [u8; 32] = raw.try_into().map_err(|_| bad())?;
    // A point that isn't on the curve can't sign anything: as an unknown key, it signs nothing.
    let key = VerifyingKey::from_bytes(&raw).map_err(|_| bad())?;
    Ok((raw, key))
}

/// A key to trust: its id when it was published with one, and the raw key in base64.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyEntry {
    pub id: Option<String>,
    pub public_key: String,
}

impl KeyEntry {
    /// A key given by hand (`--key`), without an id.
    pub fn given(public_key: impl Into<String>) -> Self {
        Self {
            id: None,
            public_key: public_key.into(),
        }
    }
}

impl From<&brand::ReleaseKey> for KeyEntry {
    fn from(k: &brand::ReleaseKey) -> Self {
        Self {
            id: Some(k.id.to_string()),
            public_key: k.public_key.to_string(),
        }
    }
}

/// The release keys this copy trusts (@pnw/brand `releaseKeys`).
pub fn brand_keys() -> Vec<KeyEntry> {
    brand::RELEASE_KEYS.iter().map(KeyEntry::from).collect()
}

/// Trusted keys by id, checking each entry's id against its key.
pub fn trusted_keys(entries: &[KeyEntry]) -> Result<BTreeMap<String, VerifyingKey>, ReleaseError> {
    let mut out = BTreeMap::new();
    for entry in entries {
        let (raw, key) = public_key_from_base64(&entry.public_key)?;
        let id = key_id(&raw);
        if let Some(said) = &entry.id
            && said != &id
        {
            return err(format!("A release key's id says {said}, but its key's id is {id}"));
        }
        out.insert(id, key);
    }
    Ok(out)
}

/// A parsed release.sig.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureFile {
    pub key: String,
    pub sig: [u8; 64],
}

pub fn parse_signature(text: &str) -> Result<SignatureFile, ReleaseError> {
    let s: Value = serde_json::from_str(text).or_else(|_| err("release.sig isn't JSON"))?;
    let key = s.get("key").and_then(Value::as_str).filter(|k| is_key_id(k));
    let sig = s.get("sig").and_then(Value::as_str);
    let (Some(key), Some(sig)) = (key, sig) else {
        return err("release.sig needs a key id (16 hex) and a signature");
    };
    let bad = || ReleaseError("release.sig's signature isn't 64 bytes in base64".into());
    let raw = B64.decode(sig).map_err(|_| bad())?;
    if raw.len() != 64 || B64.encode(&raw) != sig {
        return Err(bad());
    }
    Ok(SignatureFile {
        key: key.to_string(),
        sig: raw.try_into().map_err(|_| bad())?,
    })
}

/// Whether `sig` signs `digest` (hex) under one of `keys`; the signing key's id when it does.
/// Strict Ed25519 verification (canonical encodings, no small-order keys): a signature made by
/// `sign.mjs` passes, and nothing odd that some verifiers tolerate does.
pub fn check_signature(digest: &str, sig: &SignatureFile, keys: &BTreeMap<String, VerifyingKey>) -> Result<String, ReleaseError> {
    if keys.is_empty() {
        return err("No release keys to check against: none are published yet. Pass --key with the public key to trust.");
    }
    let Some(key) = keys.get(&sig.key) else {
        return err(format!("release.sig is signed by key {}, which isn't a release key", sig.key));
    };
    let bytes = decode_hex(digest).ok_or_else(|| ReleaseError("A digest is 64 hex characters".into()))?;
    if key.verify_strict(&bytes, &Signature::from_bytes(&sig.sig)).is_err() {
        return err(format!("release.sig doesn't sign this release's digest (key {})", sig.key));
    }
    Ok(sig.key.clone())
}

pub(crate) fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| s.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect()
}

/// Compares a bundle's files with the list: one plain sentence per problem.
pub fn compare_files(expected: &BTreeMap<String, String>, actual: &BTreeMap<String, String>) -> Vec<String> {
    let mut problems = Vec::new();
    for (path, hash) in expected {
        match actual.get(path) {
            None => problems.push(format!("missing: {path}")),
            Some(h) if h != hash => problems.push(format!("changed: {path}")),
            _ => {}
        }
    }
    for path in actual.keys() {
        if !expected.contains_key(path) {
            problems.push(format!("not in the release: {path}"));
        }
    }
    problems
}

/// What checking a release found.
#[derive(Debug, Clone)]
pub struct ReleaseReport {
    /// Each check, passed or failed and why, in the order a person reads them.
    pub report: Report,
    /// The manifest, when release.json could be read.
    pub manifest: Option<Manifest>,
    /// The problems, one sentence each, as `verify.mjs` prints them.
    pub problems: Vec<String>,
    pub signer: Option<String>,
    pub height: Option<u64>,
    /// Whether the signed list carries the commit (as its one build id).
    pub commit_signed: bool,
}

impl ReleaseReport {
    pub fn verified(&self) -> bool {
        self.manifest.is_some() && self.problems.is_empty()
    }
}

/// Checks a release folder: `keys` are the keys to trust (the brand's, or only those given);
/// `anchor`, when given, is where the anchor is read.
pub fn verify_release(dir: &Path, keys: &[KeyEntry], anchor: Option<&dyn Explorer>) -> ReleaseReport {
    let mut report = Report::new(format!("Release at {}", dir.display()));
    let mut problems = Vec::new();
    let read = |name: &str| fs::read_to_string(dir.join(name)).map_err(|_| ReleaseError(format!("No {name} in {}", dir.display())));
    let fatal = |mut report: Report, label: &str, e: ReleaseError| {
        report.push(Check::fail(label, e.0.clone()));
        ReleaseReport {
            report,
            manifest: None,
            problems: vec![e.0],
            signer: None,
            height: None,
            commit_signed: false,
        }
    };

    const LIST: &str = "release.json is well formed and its digest is its list's";
    let manifest = match read(MANIFEST).and_then(|t| parse_manifest(&t)) {
        Ok(m) => m,
        Err(e) => return fatal(report, LIST, e),
    };
    report.push(Check::pass(
        LIST,
        format!(
            "{} (commit {}, {}): {} files, digest {}",
            manifest.version,
            manifest.commit,
            manifest.created,
            manifest.files.len(),
            manifest.digest
        ),
    ));

    const SIGNED: &str = "Signed by a release key";
    let signer = read(SIGNATURE)
        .and_then(|t| parse_signature(&t))
        .and_then(|s| trusted_keys(keys).and_then(|k| check_signature(&manifest.digest, &s, &k)));
    let signer = match signer {
        Ok(id) => {
            report.push(Check::pass(SIGNED, format!("Release key {id}")));
            Some(id)
        }
        Err(e) => {
            report.push(Check::fail(SIGNED, e.0.clone()));
            problems.push(e.0);
            None
        }
    };

    const FILES: &str = "Every file matches, and there is nothing else";
    let actual = match hash_bundle(dir) {
        Ok(a) => a,
        Err(e) => return fatal(report, FILES, e),
    };
    let differences = compare_files(&manifest.files, &actual);
    if differences.is_empty() {
        report.push(Check::pass(FILES, format!("{} files", manifest.files.len())));
    } else {
        report.push(Check::fail(FILES, summarise(&differences)));
        problems.extend(differences);
    }

    const COMMIT: &str = "Built as the commit release.json names";
    let ids = build_ids(&manifest.files);
    let commit_signed = ids.len() == 1 && ids[0] == manifest.commit;
    if ids.iter().any(|id| id != &manifest.commit) {
        let p = format!(
            "release.json names commit {}, but the bundle was built as {}",
            manifest.commit,
            ids.join(", ")
        );
        report.push(Check::fail(COMMIT, p.clone()));
        problems.push(p);
    } else if commit_signed {
        report.push(Check::pass(
            COMMIT,
            "The signature covers the files and so the commit (the bundle's build id); the version and the date are release.json's word",
        ));
    } else {
        report.push(Check::pass(
            COMMIT,
            "The list names no build id: the signature covers the files; the version, the commit and the date are release.json's word",
        ));
    }

    let mut height = None;
    if let Some(explorer) = anchor {
        const ANCHORED: &str = "Anchored on Aleo";
        match chain::anchor_height(explorer, &manifest.digest) {
            Ok(Some(h)) => {
                report.push(Check::pass(ANCHORED, format!("In block {}", thousands(h))));
                height = Some(h);
            }
            Ok(None) => {
                let p = format!(
                    "The digest isn't anchored on Aleo ({}, {})",
                    chain::AUDIT_LOG_PROGRAM,
                    chain::AUDIT_EVENT_HEIGHT
                );
                report.push(Check::fail(ANCHORED, p.clone()));
                problems.push(p);
            }
            Err(e) => {
                let p = format!("Couldn't read the anchor: {e}");
                report.push(Check::fail(ANCHORED, p.clone()));
                problems.push(p);
            }
        }
    }
    ReleaseReport {
        report,
        manifest: Some(manifest),
        problems,
        signer,
        height,
        commit_signed,
    }
}

fn summarise(problems: &[String]) -> String {
    let mut out: Vec<String> = problems.iter().take(10).cloned().collect();
    if problems.len() > 10 {
        out.push(format!("… and {} more", problems.len() - 10));
    }
    out.join("; ")
}

/// A number with commas, as `toLocaleString("en-US")` writes it.
pub fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}
