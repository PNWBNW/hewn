//! Updates: checked once when the app starts, downloaded in the background, installed when the
//! person closes the app, so nothing restarts under them while their books are open.
//!
//! An update is accepted only when it is signed with the operator's update key, the minisign key
//! whose public half is `plugins.updater.pubkey` in tauri.conf.json (from `BRAND.desktop.updateKey`
//! in @pnw/brand). The updater checks the signature on the downloaded bytes before it keeps them
//! and again before it installs them, and `requireSignedVersion` makes the signature name the
//! version it was made for, so an old signed release can't be passed off as a new one. No host,
//! domain or DNS change can get anything else installed: the most they can do is withhold updates.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// A verified update, downloaded and waiting for the app to close.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

/// The update key from the app's configuration, or `None` while it is still empty.
pub fn update_key<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let key = app.config().plugins.0.get("updater")?.get("pubkey")?.as_str()?.trim().to_owned();
    (!key.is_empty()).then_some(key)
}

/// Starts the check. Does nothing when no update key is configured: an app that can't verify an
/// update never asks for one.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    app.manage(Pending::default());
    if update_key(&app).is_none() {
        eprintln!("updates: no update key configured, so updates are off");
        return;
    }
    tauri::async_runtime::spawn(async move {
        match fetch(&app).await {
            Ok(Some((update, bytes))) => {
                let version = update.version.clone();
                if let Ok(mut slot) = app.state::<Pending>().0.lock() {
                    *slot = Some((update, bytes));
                }
                // Said in the title bar: the pages have no channel to the app, by design.
                if let Some(window) = app.get_webview_window("main") {
                    let title = window.title().unwrap_or_default();
                    let _ = window.set_title(&format!("{title} (version {version} installs when you close the app)"));
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("updates: {error}"),
        }
    });
}

/// Checks for an update and downloads it. The bytes come back only if they verify under the
/// update key (`Update::download` checks them).
async fn fetch<R: Runtime>(app: &AppHandle<R>) -> tauri_plugin_updater::Result<Option<(Update, Vec<u8>)>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    // The person closed the app on purpose: the Windows installer doesn't open it again.
    let update = update.restart_after_install(false);
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

/// Installs the waiting update, if there is one. Called as the app exits; `install` verifies the
/// bytes once more before it touches anything.
pub fn install_pending<R: Runtime>(app: &AppHandle<R>) {
    let Some(pending) = app.try_state::<Pending>() else { return };
    let Some((update, bytes)) = pending.0.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    if let Err(error) = update.install(bytes) {
        eprintln!("updates: version {} was not installed: {error}", update.version);
    }
}
