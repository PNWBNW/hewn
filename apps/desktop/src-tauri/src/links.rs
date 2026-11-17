//! Where a link may go. The window shows only the app's own pages, served from the bundle inside
//! the app; a web link opens in the person's own browser, and everything else goes nowhere.
//!
//! The app's origin is `tauri://localhost` on macOS and Linux and `https://tauri.localhost` on
//! Windows (`useHttpsScheme` in tauri.conf.json); `http://tauri.localhost` is what Windows would
//! use without it, accepted so a stray link there still lands on the app.

use tauri::Url;

/// What to do with a URL the page navigates to, opens in a new window, or downloads from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    /// One of the app's own pages, or something the page made itself (`blob:`, `data:`): stays in
    /// the window.
    App,
    /// A web page or an email address: opens in the person's browser or mail app, never in the
    /// window, so no outside page ever runs with the app's origin.
    Browser,
    /// Anything else (`http:`, `file:`, `javascript:`, another app's link such as `shield:`):
    /// refused.
    Blocked,
}

/// Whether `url` is one of the app's own pages, on any platform.
pub fn is_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "https" | "http" => url.host_str() == Some("tauri.localhost") && url.port().is_none(),
        _ => false,
    }
}

/// Sorts a URL into one of the three kinds above.
pub fn classify(url: &Url) -> Link {
    if is_app(url) {
        return Link::App;
    }
    match url.scheme() {
        // A blob made by one of the app's pages names that page's origin inside it.
        "blob" => match Url::parse(url.path()) {
            Ok(inner) if is_app(&inner) => Link::App,
            _ => Link::Blocked,
        },
        "data" => Link::App,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_apps_own_pages_stay_in_the_window_on_every_platform() {
        for s in [
            "tauri://localhost/",
            "tauri://localhost/settings/setup/",
            "https://tauri.localhost/",
            "https://tauri.localhost/payroll/",
            "http://tauri.localhost/",
        ] {
            assert_eq!(classify(&url(s)), Link::App, "{s}");
        }
    }

    #[test]
    fn what_the_page_made_itself_stays() {
        assert_eq!(classify(&url("blob:tauri://localhost/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed")), Link::App);
        assert_eq!(classify(&url("blob:https://tauri.localhost/1b9d6bcd")), Link::App);
        assert_eq!(classify(&url("data:text/plain,hello")), Link::App);
        assert_eq!(classify(&url("about:blank")), Link::App);
    }

    #[test]
    fn web_links_open_in_the_browser() {
        for s in [
            "https://github.com/PNWBNW/hewn",
            "https://www.hewnaccounting.com/",
            "https://explorer.provable.com/transaction/at1",
            "mailto:someone@example.com",
        ] {
            assert_eq!(classify(&url(s)), Link::Browser, "{s}");
        }
    }

    #[test]
    fn a_look_alike_of_the_app_is_not_the_app() {
        // Not the app's pages: a web address like any other, so the browser gets it.
        assert_eq!(classify(&url("https://tauri.localhost:8443/")), Link::Browser);
        assert_eq!(classify(&url("https://tauri.localhost.example.com/")), Link::Browser);
        assert!(!is_app(&url("https://tauri.localhost:8443/")));
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
            "about:srcdoc",
        ] {
            assert_eq!(classify(&url(s)), Link::Blocked, "{s}");
        }
    }

    #[test]
    fn downloads_only_from_the_app() {
        assert!(may_download(&url("blob:tauri://localhost/1b9d6bcd")));
        assert!(may_download(&url("data:application/octet-stream;base64,AAAA")));
        assert!(!may_download(&url("https://example.com/file.exe")));
        assert!(!may_download(&url("blob:https://example.com/1b9d6bcd")));
    }
}
