//! What the tests share: a scratch folder, a copy of the release fixture, and an explorer that
//! answers from a table instead of the network.
#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use pnw_verify::chain::{Answer, Explorer, ReadError};

/// The repository's root.
pub fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap()
}

/// The signed bundle `scripts/release/release.test.mjs` checks.
pub fn release_fixture() -> PathBuf {
    repo().join("scripts/release/fixture/bundle")
}

pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// A new empty folder under the system's temporary folder, removed when dropped.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new() -> Self {
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("pnw-verify-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A copy of the release fixture to change.
pub fn bundle_copy() -> (Scratch, PathBuf) {
    let scratch = Scratch::new();
    let dir = scratch.0.join("bundle");
    copy_dir(&release_fixture(), &dir);
    (scratch, dir)
}

/// An explorer that answers from a table: a path with a JSON body, 404 for what it doesn't
/// hold, or a status. It records every path asked.
#[derive(Default)]
pub struct Table {
    pub answers: HashMap<String, Result<serde_json::Value, u16>>,
    pub asked: RefCell<Vec<String>>,
}

impl Table {
    pub fn json(mut self, path: &str, body: serde_json::Value) -> Self {
        self.answers.insert(path.to_string(), Ok(body));
        self
    }
    pub fn status(mut self, path: &str, code: u16) -> Self {
        self.answers.insert(path.to_string(), Err(code));
        self
    }
}

impl Explorer for Table {
    fn get(&self, path: &str) -> Result<Answer, ReadError> {
        self.asked.borrow_mut().push(path.to_string());
        match self.answers.get(path) {
            None => Ok(Answer::NotFound),
            Some(Ok(v)) => Ok(Answer::Json(v.clone())),
            Some(Err(code)) => Err(ReadError::Status(*code)),
        }
    }
}

/// The explorer path of a hash's anchor.
pub fn anchor_path(hash: &str) -> String {
    format!(
        "/program/{}/mapping/audit_event_height/{}",
        pnw_verify::chain::AUDIT_LOG_PROGRAM,
        pnw_verify::chain::mapping_key(hash).unwrap()
    )
}
