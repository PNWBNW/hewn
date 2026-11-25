//! The release checks against scripts/release/fixture, the bundle the JavaScript tests check, and
//! the ways a release must fail.

mod common;

use std::collections::BTreeMap;
use std::fs;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use common::*;
use ed25519_dalek::{Signer, SigningKey};
use pnw_verify::generated::brand;
use pnw_verify::release::*;
use serde_json::json;

const DIGEST: &str = "78c73e586e4783294e32ca45bf935aa8b7a82dc4b3e5418ae3d4cffa006bd153";

fn fixture_key() -> Vec<KeyEntry> {
    vec![KeyEntry::from(&brand::RELEASE_KEY_FIXTURE)]
}

/// A key made here, for signatures nobody published.
fn stranger() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn stranger_entry() -> KeyEntry {
    KeyEntry::given(B64.encode(stranger().verifying_key().to_bytes()))
}

fn sign_with(key: &SigningKey, id: &str, digest: &str) -> String {
    let sig = key.sign(&hex_bytes(digest));
    json!({ "key": id, "sig": B64.encode(sig.to_bytes()) }).to_string()
}

fn hex_bytes(h: &str) -> Vec<u8> {
    (0..h.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn the_fixture_verifies_as_verify_mjs_says() {
    let r = verify_release(&release_fixture(), &fixture_key(), None);
    assert!(r.verified(), "{}", r.report.text());
    assert!(r.report.passed());
    let m = r.manifest.unwrap();
    assert_eq!(m.digest, DIGEST);
    assert_eq!(m.version, "v0.0-fixture");
    assert_eq!(m.files.len(), 3);
    assert_eq!(r.signer.as_deref(), Some("e8605ea7f54dad93"));
    // The fixture's list names no build id: the commit is release.json's word.
    assert!(!r.commit_signed);
}

#[test]
fn the_digest_is_the_canonical_lists() {
    let m = parse_manifest(&fs::read_to_string(release_fixture().join("release.json")).unwrap()).unwrap();
    assert_eq!(
        canonical_files(&m.files),
        r#"{"_next/static/app.css":"e4714234a4b3dcbd9642d20a4b69dc086845ded49ebabbf5fc5000bfd5c57db8","index.html":"e9835cef364f414b7e5617126232e2d663c000a086c13bd194ad6d00ee0a8bb4","terms/index.html":"24d05e7a76b1b235b2a811e81befc03b112b89f8bba7283268a36007e756d445"}"#
    );
    assert_eq!(files_digest(&m.files), DIGEST);
    assert_eq!(hash_bundle(&release_fixture()).unwrap(), m.files);
}

#[test]
fn a_keys_id_is_its_hashs_first_16_hex() {
    let (raw, _) = public_key_from_base64(brand::RELEASE_KEY_FIXTURE.public_key).unwrap();
    assert_eq!(key_id(&raw), brand::RELEASE_KEY_FIXTURE.id);
}

#[test]
fn no_key_is_trusted_until_one_is_published() {
    assert!(brand::RELEASE_KEYS.is_empty(), "this test describes the brand before its first key");
    let r = verify_release(&release_fixture(), &brand_keys(), None);
    assert!(!r.verified());
    assert_eq!(
        r.problems,
        vec!["No release keys to check against: none are published yet. Pass --key with the public key to trust."]
    );
}

#[test]
fn a_tampered_file_fails_and_is_named() {
    let (_s, dir) = bundle_copy();
    fs::write(dir.join("index.html"), "<p>something else</p>").unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert!(!r.verified());
    assert_eq!(r.problems, vec!["changed: index.html"]);
    // The signature still signs the list: only the file is wrong.
    assert_eq!(r.signer.as_deref(), Some("e8605ea7f54dad93"));
}

#[test]
fn a_missing_or_added_file_fails_and_is_named() {
    let (_s, dir) = bundle_copy();
    fs::remove_file(dir.join("terms/index.html")).unwrap();
    fs::write(dir.join("extra.js"), "alert(1)").unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert_eq!(r.problems, vec!["missing: terms/index.html", "not in the release: extra.js"]);
}

#[test]
fn an_unknown_key_fails() {
    let (_s, dir) = bundle_copy();
    let id = key_id(&stranger().verifying_key().to_bytes());
    fs::write(dir.join("release.sig"), sign_with(&stranger(), &id, DIGEST)).unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert_eq!(
        r.problems,
        vec![format!("release.sig is signed by key {id}, which isn't a release key")]
    );
}

#[test]
fn a_signature_by_another_key_under_a_trusted_id_fails() {
    let (_s, dir) = bundle_copy();
    fs::write(dir.join("release.sig"), sign_with(&stranger(), "e8605ea7f54dad93", DIGEST)).unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert_eq!(
        r.problems,
        vec!["release.sig doesn't sign this release's digest (key e8605ea7f54dad93)"]
    );
}

#[test]
fn the_fixture_signature_fails_under_a_wrong_key() {
    // Trusting only another key: the fixture's signer is unknown.
    let r = verify_release(&release_fixture(), &[stranger_entry()], None);
    assert_eq!(
        r.problems,
        vec!["release.sig is signed by key e8605ea7f54dad93, which isn't a release key"]
    );
}

#[test]
fn a_key_published_under_the_wrong_id_is_refused() {
    let bad = KeyEntry {
        id: Some("0000000000000000".into()),
        public_key: brand::RELEASE_KEY_FIXTURE.public_key.into(),
    };
    let r = verify_release(&release_fixture(), &[bad], None);
    assert_eq!(
        r.problems,
        vec!["A release key's id says 0000000000000000, but its key's id is e8605ea7f54dad93"]
    );
}

#[test]
fn a_missing_signature_fails() {
    let (_s, dir) = bundle_copy();
    fs::remove_file(dir.join("release.sig")).unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert_eq!(r.problems, vec![format!("No release.sig in {}", dir.display())]);
    assert_eq!(r.signer, None);
}

#[test]
fn a_malformed_signature_fails() {
    let (_s, dir) = bundle_copy();
    for (text, why) in [
        ("not json", "release.sig isn't JSON"),
        (
            r#"{"key":"E8605EA7F54DAD93","sig":"AA=="}"#,
            "release.sig needs a key id (16 hex) and a signature",
        ),
        (
            r#"{"key":"e8605ea7f54dad93","sig":"AAAA"}"#,
            "release.sig's signature isn't 64 bytes in base64",
        ),
    ] {
        fs::write(dir.join("release.sig"), text).unwrap();
        let r = verify_release(&dir, &fixture_key(), None);
        assert_eq!(r.problems, vec![why.to_string()], "{text}");
    }
}

#[test]
fn a_wrong_digest_fails_before_anything_else() {
    let (_s, dir) = bundle_copy();
    let text = fs::read_to_string(dir.join("release.json"))
        .unwrap()
        .replace(DIGEST, &"0".repeat(64));
    fs::write(dir.join("release.json"), text).unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert!(!r.verified());
    assert!(r.manifest.is_none());
    assert_eq!(r.problems, vec!["release.json's digest doesn't match its list of files"]);
}

#[test]
fn an_edited_list_no_longer_matches_its_signature() {
    let (_s, dir) = bundle_copy();
    fs::write(dir.join("index.html"), "<p>swapped</p>").unwrap();
    let mut files: BTreeMap<String, String> = hash_bundle(&dir).unwrap();
    let digest = files_digest(&files);
    let manifest =
        json!({ "version": "v0.0-fixture", "commit": "0".repeat(40), "created": "2026-11-17", "files": files.clone(), "digest": digest });
    fs::write(dir.join("release.json"), manifest.to_string()).unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert_eq!(
        r.problems,
        vec!["release.sig doesn't sign this release's digest (key e8605ea7f54dad93)"]
    );
    files.clear();
}

#[test]
fn a_release_json_naming_another_commit_than_its_build_fails() {
    let (_s, dir) = bundle_copy();
    let built = "1".repeat(40);
    fs::create_dir_all(dir.join(format!("_next/static/{built}"))).unwrap();
    fs::write(dir.join(format!("_next/static/{built}/page.js")), "x").unwrap();
    let files = hash_bundle(&dir).unwrap();
    let digest = files_digest(&files);
    let manifest = json!({ "version": "v1.2", "commit": "2".repeat(40), "created": "2026-11-17", "files": files, "digest": digest });
    fs::write(dir.join("release.json"), manifest.to_string()).unwrap();
    let signer = SigningKey::from_bytes(&[9u8; 32]);
    let id = key_id(&signer.verifying_key().to_bytes());
    fs::write(dir.join("release.sig"), sign_with(&signer, &id, &digest)).unwrap();
    let trusted = [KeyEntry::given(B64.encode(signer.verifying_key().to_bytes()))];
    let r = verify_release(&dir, &trusted, None);
    assert_eq!(
        r.problems,
        vec![format!(
            "release.json names commit {}, but the bundle was built as {built}",
            "2".repeat(40)
        )]
    );

    // Named as the commit it was built from, the same bundle verifies, and the commit is signed.
    let manifest =
        json!({ "version": "v1.2", "commit": built, "created": "2026-11-17", "files": hash_bundle(&dir).unwrap(), "digest": digest });
    fs::write(dir.join("release.json"), manifest.to_string()).unwrap();
    let r = verify_release(&dir, &trusted, None);
    assert!(r.verified(), "{}", r.report.text());
    assert!(r.commit_signed);
}

#[cfg(unix)]
#[test]
fn a_bundle_holding_a_link_fails() {
    let (_s, dir) = bundle_copy();
    std::os::unix::fs::symlink("/etc/hostname", dir.join("link.txt")).unwrap();
    let r = verify_release(&dir, &fixture_key(), None);
    assert!(!r.verified());
    assert_eq!(r.problems, vec!["The bundle holds a link, which a release can't: link.txt"]);
}

#[test]
fn a_manifest_listing_a_path_a_release_cant_carry_fails() {
    for bad in ["../outside", "/etc/passwd", "a//b", "./a", "release.sig", "a\\b"] {
        let files = json!({ bad: "0".repeat(64) });
        let text = json!({ "version": "v1", "commit": "0".repeat(40), "created": "2026-11-17", "files": files, "digest": "0".repeat(64) })
            .to_string();
        let e = parse_manifest(&text).unwrap_err();
        assert!(e.0.starts_with("release.json lists a path a release can't carry"), "{bad}: {e}");
    }
}

#[test]
fn the_anchor_is_read_and_its_absence_or_failure_reported() {
    let anchored = Table::default().json(&anchor_path(DIGEST), json!("21235519u32"));
    let r = verify_release(&release_fixture(), &fixture_key(), Some(&anchored));
    assert!(r.verified());
    assert_eq!(r.height, Some(21_235_519));
    assert!(r.report.text().contains("In block 21,235,519"));

    let r = verify_release(&release_fixture(), &fixture_key(), Some(&Table::default()));
    assert_eq!(
        r.problems,
        vec!["The digest isn't anchored on Aleo (payroll_audit_log.aleo, audit_event_height)"]
    );

    let null = Table::default().json(&anchor_path(DIGEST), serde_json::Value::Null);
    assert_eq!(verify_release(&release_fixture(), &fixture_key(), Some(&null)).height, None);

    let down = Table::default().status(&anchor_path(DIGEST), 500);
    let r = verify_release(&release_fixture(), &fixture_key(), Some(&down));
    assert_eq!(r.problems, vec!["Couldn't read the anchor: The explorer answered 500"]);

    let odd = Table::default().json(&anchor_path(DIGEST), json!("21235519u64"));
    let r = verify_release(&release_fixture(), &fixture_key(), Some(&odd));
    assert_eq!(
        r.problems,
        vec!["Couldn't read the anchor: The explorer sent the anchor in an unexpected shape"]
    );
}
