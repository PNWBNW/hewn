//! Where a link may go. The window shows only the app's own pages, served from the bundle inside
//! the app; a web link opens in the person's own browser, and everything else goes nowhere.
//!
//! The app's origin is `tauri://localhost` on macOS and Linux and `https://tauri.localhost` on
//! Windows (`useHttpsScheme` in tauri.conf.json). Only this system's own origin counts as the app:
//! on the other systems, and in the `http:` form on Windows, the same name is an ordinary address
//! (`.localhost` is this computer), where any program on it could answer.

use std::path::Path;

use tauri::Url;

/// What to do with a URL the page navigates to, opens in a new window, or downloads from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    /// One of the app's own pages, or a file one of them made (`blob:`): stays in the window.
    App,
    /// A web page or an email address: opens in the person's browser or mail app, never in the
    /// window, so no outside page ever runs with the app's origin.
    Browser,
    /// Anything else (`http:`, `file:`, `data:`, `javascript:`, another app's link such as
    /// `shield:`): refused. A `data:` page would run outside the app's security policy, and the
    /// app makes none (its downloads are `blob:`).
    Blocked,
}

/// Whether `url` is one of the app's own pages on this system.
pub fn is_app(url: &Url) -> bool {
    is_app_on(url, cfg!(windows))
}

/// Whether `url` is one of the app's own pages on Windows (`windows`) or on macOS and Linux.
pub fn is_app_on(url: &Url, windows: bool) -> bool {
    if windows {
        url.scheme() == "https" && url.host_str() == Some("tauri.localhost") && url.port().is_none()
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none()
    }
}

/// Sorts a URL into one of the three kinds above, on this system.
pub fn classify(url: &Url) -> Link {
    classify_on(url, cfg!(windows))
}

/// `classify` as it runs on Windows (`windows`) or on macOS and Linux.
pub fn classify_on(url: &Url, windows: bool) -> Link {
    if is_app_on(url, windows) {
        return Link::App;
    }
    match url.scheme() {
        // A blob made by one of the app's pages names that page's origin inside it.
        "blob" => match Url::parse(url.path()) {
            Ok(inner) if is_app_on(&inner, windows) => Link::App,
            _ => Link::Blocked,
        },
        "about" if url.as_str() == "about:blank" => Link::App,
        "https" | "mailto" => Link::Browser,
        _ => Link::Blocked,
    }
}

/// Whether the window may save a download: only what the app's own pages made (a backup file, a
/// report), never a file from elsewhere.
pub fn may_download(url: &Url) -> bool {
    classify(url) == Link::App
}

/// Whether a download's destination is a file directly in the Downloads folder. On macOS and
/// Linux the web view joins the name the page suggested (for an offer's attachment, a name the
/// other party chose) onto that folder; this refuses any name that would land anywhere else.
pub fn saves_into(folder: &Path, destination: &Path) -> bool {
    destination.parent() == Some(folder)
        && destination.file_name().is_some_and(|name| Path::new(name).components().count() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    /// The same URL sorted as it would be on macOS and Linux, and on Windows.
    fn on_both(s: &str) -> (Link, Link) {
        (classify_on(&url(s), false), classify_on(&url(s), true))
    }

    #[test]
    fn the_apps_own_pages_stay_in_the_window_on_every_platform() {
        for s in ["tauri://localhost/", "tauri://localhost/settings/setup/"] {
            assert_eq!(classify_on(&url(s), false), Link::App, "{s} on macOS and Linux");
        }
        for s in ["https://tauri.localhost/", "https://tauri.localhost/payroll/"] {
            assert_eq!(classify_on(&url(s), true), Link::App, "{s} on Windows");
        }
    }

    #[test]
    fn only_this_systems_origin_is_the_app() {
        // The Windows origin elsewhere is an address on this computer: a web link, not the app.
        assert_eq!(on_both("https://tauri.localhost/"), (Link::Browser, Link::App));
        // And the macOS and Linux origin means nothing on Windows.
        assert_eq!(on_both("tauri://localhost/"), (Link::App, Link::Blocked));
        // `http://tauri.localhost` is no system's app (useHttpsScheme): any local program could
        // answer there, so it is refused everywhere.
        assert_eq!(on_both("http://tauri.localhost/"), (Link::Blocked, Link::Blocked));
        assert_eq!(on_both("blob:http://tauri.localhost/1b9d6bcd"), (Link::Blocked, Link::Blocked));
        assert_eq!(is_app(&url("tauri://localhost/")), !cfg!(windows));
    }

    #[test]
    fn what_the_page_made_itself_stays() {
        assert_eq!(classify_on(&url("blob:tauri://localhost/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"), false), Link::App);
        assert_eq!(classify_on(&url("blob:https://tauri.localhost/1b9d6bcd"), true), Link::App);
        assert_eq!(on_both("about:blank"), (Link::App, Link::App));
    }

    #[test]
    fn web_links_open_in_the_browser() {
        for s in [
            "https://github.com/PNWBNW/hewn",
            "https://www.hewnaccounting.com/",
            "https://explorer.provable.com/transaction/at1",
            "mailto:someone@example.com",
        ] {
            assert_eq!(on_both(s), (Link::Browser, Link::Browser), "{s}");
        }
    }

    #[test]
    fn a_look_alike_of_the_app_is_not_the_app() {
        // Not the app's pages: a web address like any other, so the browser gets it.
        assert_eq!(on_both("https://tauri.localhost:8443/"), (Link::Browser, Link::Browser));
        assert_eq!(on_both("https://tauri.localhost.example.com/"), (Link::Browser, Link::Browser));
        assert!(!is_app_on(&url("https://tauri.localhost:8443/"), true));
        assert!(!is_app_on(&url("tauri://localhost:1/"), false));
    }

    #[test]
    fn everything_else_is_refused() {
        for s in [
            "http://example.com/",
            "http://tauri.localhost:8080/",
            "tauri://elsewhere/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "shield://wake?channelId=x",
            "blob:https://example.com/1b9d6bcd",
            "data:text/html,<script>alert(1)</script>",
            "about:srcdoc",
        ] {
            assert_eq!(on_both(s), (Link::Blocked, Link::Blocked), "{s}");
        }
    }

    #[test]
    fn downloads_only_from_the_app() {
        assert_eq!(may_download(&url("blob:tauri://localhost/1b9d6bcd")), !cfg!(windows));
        assert_eq!(may_download(&url("blob:https://tauri.localhost/1b9d6bcd")), cfg!(windows));
        assert!(!may_download(&url("data:application/octet-stream;base64,AAAA")));
        assert!(!may_download(&url("https://example.com/file.exe")));
        assert!(!may_download(&url("blob:https://example.com/1b9d6bcd")));
    }

    #[test]
    fn a_download_lands_only_in_the_downloads_folder() {
        let folder = Path::new("/home/someone/Downloads");
        assert!(saves_into(folder, Path::new("/home/someone/Downloads/offer.pdf")));
        assert!(saves_into(folder, Path::new("/home/someone/Downloads/.hidden")));
        // A suggested name that climbs out, replaces the whole path, or goes into a folder.
        assert!(!saves_into(folder, Path::new("/home/someone/Downloads/../.bashrc")));
        assert!(!saves_into(folder, Path::new("/home/someone/.config/autostart/x.desktop")));
        assert!(!saves_into(folder, Path::new("/home/someone/Downloads/sub/x.pdf")));
        assert!(!saves_into(folder, Path::new("/home/someone/Downloads")));
        assert!(!saves_into(folder, Path::new("/")));
    }
}
