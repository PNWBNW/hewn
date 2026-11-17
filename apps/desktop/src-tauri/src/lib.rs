//! The desktop app: one window running the static bundle (apps/business/out), carried inside the
//! app and served from the app's own origin, and an updater that installs only what the operator
//! signed. See ../README.md.
//!
//! Least privilege. The pages get no bridge to the app: no capability is granted to any window
//! (`app.security.capabilities` is empty in tauri.conf.json), so they can call nothing here, and
//! the app adds nothing a browser wouldn't give them. The security policy is the one the bundle
//! carries in each page's meta tag; Tauri adds none of its own (`csp` is null), so the policy is
//! the website's, word for word. What runs in Rust: keeping the window on the app's own pages
//! (`links`), opening web links in the person's browser, and the updater (`update`).

pub mod links;
pub mod update;

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, RunEvent, Runtime, Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use links::Link;

/// The navigation rule: the app's pages stay, web links go to the browser, the rest nowhere.
/// Returns whether the window itself may go there.
fn follow<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    match links::classify(url) {
        Link::App => true,
        Link::Browser => {
            if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
                eprintln!("links: could not open a {} link: {error}", url.scheme());
            }
            false
        }
        Link::Blocked => false,
    }
}

/// Whether a download would be saved directly in the Downloads folder. On macOS and Linux the web
/// view puts the page's suggested name there itself, and a name from someone else (an offer's
/// attachment) must not reach another folder; on Windows the engine picks and cleans the path.
fn in_downloads<R: Runtime>(webview: &tauri::Webview<R>, destination: &std::path::Path) -> bool {
    if cfg!(windows) {
        return true;
    }
    // The folder the web view chose from (wry: the Downloads folder, or the working folder on a
    // system that names none).
    let folder = webview.path().download_dir().ok().or_else(|| std::env::current_dir().ok());
    let ok = folder.is_some_and(|folder| links::saves_into(&folder, destination));
    if !ok {
        eprintln!("links: a download outside the Downloads folder was refused");
    }
    ok
}

pub fn run() {
    let app = tauri::Builder::default()
        // Rust-side only: with no capabilities, the pages can't call either plugin.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // The one window, as tauri.conf.json describes it (`create: false` there, so it is
            // made here, with the navigation rule attached before it loads anything).
            let config = app.config().app.windows.first().cloned().ok_or("tauri.conf.json names no window")?;
            let on_navigation = app.handle().clone();
            let on_new_window = app.handle().clone();
            WebviewWindowBuilder::from_config(app, &config)?
                .on_navigation(move |url| follow(&on_navigation, url))
                // A link that asks for a new window (`target="_blank"`) never gets one: a web link
                // opens in the browser, nothing else opens at all.
                .on_new_window(move |url, _features| {
                    follow(&on_new_window, &url);
                    NewWindowResponse::Deny
                })
                // Downloads (a backup file, a report) go to the Downloads folder under the name the
                // page gave them; only what the app's own pages made, and only into that folder.
                .on_download(|webview, event| match event {
                    DownloadEvent::Requested { url, destination } => links::may_download(&url) && in_downloads(&webview, destination),
                    _ => true,
                })
                .build()?;
            update::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the desktop app could not start");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            update::install_pending(app);
        }
    });
}
