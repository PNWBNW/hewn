//! The updater installs only what the update key signed (src/update.rs): the exit criterion
//! "refuses an update signed with any other key", checked on the same code the app runs
//! (tauri-plugin-updater's own check, as configured from tauri.conf.json's `plugins.updater`).
//!
//! Every key here is made in memory for the test and dropped with it. None is the operator's.

use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign::{KeyPair, SecretKey};
use serde_json::json;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::App;
use tauri_plugin_updater::{Update, UpdaterExt};

const PACKAGE: &[u8] = b"the update package's bytes";

/// A throwaway key pair: the public half as tauri.conf.json carries it (base64 of the minisign
/// public key box, as `cargo tauri signer generate` prints it) and the secret half.
fn key_pair() -> (String, SecretKey) {
    let KeyPair { pk, sk } = KeyPair::generate_unencrypted_keypair().expect("a key pair");
    (STANDARD.encode(pk.to_box().expect("a public key box").to_string()), sk)
}

/// A signature as `cargo tauri signer sign --app-version` makes it: the version in the trusted
/// comment, the box in base64.
fn sign(sk: &SecretKey, data: &[u8], version: Option<&str>) -> String {
    let mut comment = "timestamp:0\tfile:update.tar.gz".to_owned();
    if let Some(version) = version {
        comment.push_str("\tversion:");
        comment.push_str(version);
    }
    let signature = minisign::sign(None, sk, Cursor::new(data), Some(&comment), Some("signature from tauri secret key")).expect("a signature");
    STANDARD.encode(signature.to_string())
}

/// An app whose updater is configured as tauri.conf.json configures it, with `pubkey`.
fn app_trusting(pubkey: &str) -> App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({ "pubkey": pubkey, "endpoints": ["https://example.invalid/latest.json"], "requireSignedVersion": true }),
    );
    mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).expect("the mock app")
}

/// The update an endpoint announced: `version`, the package's address, its signature.
fn announced(app: &App<MockRuntime>, version: &str, signature: &str) -> Update {
    let target = tauri_plugin_updater::target().expect("a supported system");
    let manifest = json!({
        "version": version,
        "platforms": { target: { "url": "https://example.invalid/update.tar.gz", "signature": signature } },
    });
    app.updater().expect("the updater").restore_update(manifest).expect("a valid manifest").expect("a newer version")
}

#[test]
fn accepts_a_package_signed_with_the_update_key() {
    let (pubkey, sk) = key_pair();
    let app = app_trusting(&pubkey);
    let update = announced(&app, "99.0.0", &sign(&sk, PACKAGE, Some("99.0.0")));
    update.verify(PACKAGE).expect("signed with the update key");
}

#[test]
fn refuses_a_package_signed_with_any_other_key() {
    let (pubkey, _) = key_pair();
    let (_, other) = key_pair();
    let app = app_trusting(&pubkey);
    let update = announced(&app, "99.0.0", &sign(&other, PACKAGE, Some("99.0.0")));
    assert!(update.verify(PACKAGE).is_err(), "a package signed with another key must be refused");
    // `install` checks again before it touches anything, so it refuses too.
    assert!(update.install(PACKAGE).is_err());
}

#[test]
fn refuses_a_package_changed_after_signing() {
    let (pubkey, sk) = key_pair();
    let app = app_trusting(&pubkey);
    let update = announced(&app, "99.0.0", &sign(&sk, PACKAGE, Some("99.0.0")));
    assert!(update.verify(b"the update package's bytes, changed").is_err());
}

#[test]
fn refuses_an_old_signed_package_announced_as_a_new_version() {
    // A genuine package signed for 1.0.0, announced as 99.0.0: a downgrade passed off as an update.
    let (pubkey, sk) = key_pair();
    let app = app_trusting(&pubkey);
    let update = announced(&app, "99.0.0", &sign(&sk, PACKAGE, Some("1.0.0")));
    assert!(update.verify(PACKAGE).is_err());
    // And one whose signature names no version at all.
    let update = announced(&app, "99.0.0", &sign(&sk, PACKAGE, None));
    assert!(update.verify(PACKAGE).is_err());
}

#[test]
fn an_app_without_an_update_key_accepts_nothing() {
    let (_, sk) = key_pair();
    let app = app_trusting("");
    let update = announced(&app, "99.0.0", &sign(&sk, PACKAGE, Some("99.0.0")));
    assert!(update.verify(PACKAGE).is_err());
    assert!(pnw_desktop::update::update_key(app.handle()).is_none(), "an empty key counts as none, so the app doesn't check");
}

#[test]
fn the_shipped_configuration_names_the_update_key_from_the_brand() {
    // tauri.conf.json is generated from @pnw/brand (scripts/tauri_config.mjs); here: its updater
    // section is the one this test exercises, with the signed-version check on.
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
    let updater = &config["plugins"]["updater"];
    assert!(updater["pubkey"].is_string());
    assert_eq!(updater["requireSignedVersion"], json!(true));
    assert!(updater.get("dangerousInsecureTransportProtocol").is_none());
    assert!(updater.get("dangerousAcceptInvalidCerts").is_none());
    for endpoint in updater["endpoints"].as_array().expect("endpoints") {
        assert!(endpoint.as_str().expect("a URL").starts_with("https://"));
    }
    // No capability for any window: the pages can call nothing.
    assert_eq!(config["app"]["security"]["capabilities"], json!([]));
    assert_eq!(config["app"]["security"]["csp"], json!(null));
    assert_eq!(config["app"]["withGlobalTauri"], json!(false));
}
