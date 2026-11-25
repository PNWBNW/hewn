//! One window that checks a release folder or a closed period, natively (apps/native/README.md).
//! A thin layer over the `pnw-verify` library: every check is the library's; this file only
//! picks what to check and shows each result. No wallet, no books, no keys, no signing (INV-11);
//! the only network read is the explorer, for anchors.
//!
//!   pnw-verifier [--key <base64 public key>]... [--endpoint <explorer>]
//!
//! `--key` trusts a release key by hand, as `verify.mjs --key` does, while @pnw/brand publishes
//! none.

#![cfg_attr(windows, windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;

use gpui_kit::*;
use pnw_verify::chain::HttpExplorer;
use pnw_verify::generated::{brand, config};
use pnw_verify::release::{KeyEntry, brand_keys, verify_release};
use pnw_verify::{Report, period};

/// What the window was started with.
struct Settings {
    keys: Vec<KeyEntry>,
    endpoint: String,
}

fn settings() -> Settings {
    let mut keys = Vec::new();
    let mut endpoint = config::ALEO_ENDPOINT.to_string();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match (a.as_str(), args.next()) {
            ("--key", Some(k)) => keys.push(KeyEntry::given(k)),
            ("--endpoint", Some(e)) => endpoint = e,
            _ => {}
        }
    }
    Settings {
        keys: if keys.is_empty() { brand_keys() } else { keys },
        endpoint,
    }
}

/// What to check, once chosen.
enum Job {
    Release { folder: PathBuf, anchor: bool },
    Proof { file: PathBuf },
    Public { root: String, end: String, tx: Option<String> },
}

fn run(job: Job, settings: &Settings) -> Report {
    let explorer = HttpExplorer::new(&settings.endpoint);
    match job {
        Job::Release { folder, anchor } => verify_release(&folder, &settings.keys, anchor.then_some(&explorer as _)).report,
        Job::Proof { file } => match std::fs::read_to_string(&file) {
            Ok(text) => period::verify_proof(&text, Some(&explorer)),
            Err(e) => {
                let mut r = Report::new(format!("Period proof at {}", file.display()));
                r.push(pnw_verify::Check::fail("The file can be read", e.to_string()));
                r
            }
        },
        Job::Public { root, end, tx } => period::verify_public(&root, &end, tx.as_deref(), &explorer),
    }
}

/// A root, the range's last day and, optionally, the anchoring transaction, from pasted text.
fn public_data(text: &str) -> Option<(String, String, Option<String>)> {
    let words: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|w| !w.is_empty())
        .collect();
    let root = words.iter().find(|w| w.len() == 64 && w.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let end = words
        .iter()
        .find(|w| w.len() == 10 && w.as_bytes()[4] == b'-' && w.as_bytes()[7] == b'-')?;
    let tx = words.iter().find(|w| w.starts_with("at1")).map(|w| w.to_string());
    Some((root.to_ascii_lowercase(), end.to_string(), tx))
}

struct Verifier {
    settings: Arc<Settings>,
    anchor_release: bool,
    busy: bool,
    report: Option<Report>,
    note: Option<String>,
}

impl Verifier {
    fn start(&mut self, job: Job, cx: &mut Context<Self>) {
        self.busy = true;
        self.note = None;
        self.report = None;
        cx.notify();
        let settings = self.settings.clone();
        let work = cx.background_executor().spawn(async move { run(job, &settings) });
        cx.spawn(async move |this, cx| {
            let report = work.await;
            this.update(cx, |this, cx| {
                this.busy = false;
                this.report = Some(report);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn pick(&mut self, directories: bool, cx: &mut Context<Self>) {
        let prompt = if directories {
            "Choose a release folder"
        } else {
            "Choose a period proof"
        };
        let chosen = cx.prompt_for_paths(PathPromptOptions {
            files: !directories,
            directories,
            multiple: false,
            prompt: Some(prompt.into()),
        });
        let anchor = self.anchor_release;
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = chosen.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            this.update(cx, |this, cx| {
                let job = if directories {
                    Job::Release { folder: path, anchor }
                } else {
                    Job::Proof { file: path }
                };
                this.start(job, cx);
            })
            .ok();
        })
        .detach();
    }

    fn check_clipboard(&mut self, cx: &mut Context<Self>) {
        let text = cx.read_from_clipboard().and_then(|item| item.text()).unwrap_or_default();
        match public_data(&text) {
            Some((root, end, tx)) => self.start(Job::Public { root, end, tx }, cx),
            None => {
                self.note = Some("Copy a period's root (64 hex), the range's last day (YYYY-MM-DD) and, if you have it, the transaction that anchored it (at1…), then try again.".into());
                cx.notify();
            }
        }
    }
}

fn button(id: &'static str, label: &'static str) -> Stateful<Div> {
    div()
        .id(id)
        .px_4()
        .py_2()
        .rounded_md()
        .bg(rgb(brand::colors::GREEN))
        .text_color(rgb(brand::colors::CREAM))
        .cursor_pointer()
        .hover(|s| s.opacity(0.85))
        .child(label)
}

impl Render for Verifier {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let ink = rgb(brand::colors::INK);
        let pass = rgb(0x1d6b3a);
        let fail = rgb(0xa1261d);
        let mut results = div().id("results").flex().flex_col().gap_2().flex_1().overflow_y_scroll().p_4();
        if self.busy {
            results = results.child("Checking…");
        } else if let Some(report) = &self.report {
            let verdict = if report.passed() {
                ("Verified: every check passed.", pass)
            } else {
                ("Not verified: a check failed. Don't trust it.", fail)
            };
            results = results.child(div().text_lg().font_weight(FontWeight::BOLD).child(report.title.clone()));
            results = results.child(div().text_color(verdict.1).font_weight(FontWeight::BOLD).child(verdict.0));
            for c in &report.checks {
                let (mark, colour) = if c.ok { ("Passed", pass) } else { ("Failed", fail) };
                let mut row = div().flex().flex_col().p_2().rounded_md().border_1().border_color(colour);
                row = row.child(
                    div()
                        .flex()
                        .gap_2()
                        .child(div().text_color(colour).font_weight(FontWeight::BOLD).child(mark))
                        .child(c.label.clone()),
                );
                if !c.detail.is_empty() {
                    row = row.child(div().text_sm().child(c.detail.clone()));
                }
                results = results.child(row);
            }
        } else if let Some(note) = &self.note {
            results = results.child(note.clone());
        } else {
            results = results.child("Choose what to check. Nothing leaves this computer but the explorer reads for anchors: the hash, and transaction ids that are already public.");
        }

        let toggle = div()
            .id("anchor-toggle")
            .flex()
            .gap_2()
            .cursor_pointer()
            .child(if self.anchor_release { "[x]" } else { "[ ]" })
            .child("Also read a release's anchor on Aleo")
            .on_click(cx.listener(|this, _, _, cx| {
                this.anchor_release = !this.anchor_release;
                cx.notify();
            }));

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(brand::colors::CANVAS))
            .text_color(ink)
            .child(
                div()
                    .p_4()
                    .bg(rgb(brand::colors::GREEN))
                    .text_color(rgb(brand::colors::CREAM))
                    .child(
                        div()
                            .text_xl()
                            .font_weight(FontWeight::BOLD)
                            .child(format!("{} verifier", brand::NAME)),
                    )
                    .child(
                        div()
                            .text_sm()
                            .child("Checks a release or a closed period on this computer. It holds no keys and signs nothing."),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .p_4()
                    .child(button("release", "Check a release folder…").on_click(cx.listener(|this, _, _, cx| this.pick(true, cx))))
                    .child(button("proof", "Check a period proof…").on_click(cx.listener(|this, _, _, cx| this.pick(false, cx))))
                    .child(
                        button("public", "Check a period's anchor from the clipboard")
                            .on_click(cx.listener(|this, _, _, cx| this.check_clipboard(cx))),
                    )
                    .child(toggle),
            )
            .child(results)
            .child(
                div()
                    .id("source")
                    .p_2()
                    .text_xs()
                    .cursor_pointer()
                    .child(format!(
                        "{} · {} · {} · source: {}",
                        brand::CREDIT_TEXT,
                        brand::COPYRIGHT,
                        brand::LICENCE,
                        brand::SOURCE_URL
                    ))
                    .on_click(|_, _, cx| cx.open_url(brand::SOURCE_URL)),
            )
    }
}

fn main() {
    let settings = Arc::new(settings());
    gpui_kit::application().run(move |cx: &mut App| {
        gpui_kit::init(cx);
        let bounds = Bounds::centered(None, size(px(760.), px(640.)), cx);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(TitlebarOptions {
                title: Some(format!("{} verifier", brand::NAME).into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let settings = settings.clone();
        gpui_kit::open_window(options, cx, move |_, cx| {
            cx.new(|_| Verifier {
                settings,
                anchor_release: false,
                busy: false,
                report: None,
                note: None,
            })
        })
        .expect("the window opens");
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.activate(true);
    });
}

#[cfg(test)]
mod tests {
    use super::public_data;

    #[test]
    fn pasted_public_data_is_read() {
        let text = "root 95496641A8EA9AC3F9A99ECB33E7D172BA6D99EFCD0E606DFDC8C2C6F904E68B, 2026-10-31\nat1hg2etspa7udc6nj6yja2uc7p9fnf49l9973jvh9467w277mpx5rqp500eq";
        let (root, end, tx) = public_data(text).unwrap();
        assert_eq!(root, "95496641a8ea9ac3f9a99ecb33e7d172ba6d99efcd0e606dfdc8c2c6f904e68b");
        assert_eq!(end, "2026-10-31");
        assert_eq!(tx.as_deref(), Some("at1hg2etspa7udc6nj6yja2uc7p9fnf49l9973jvh9467w277mpx5rqp500eq"));
        assert_eq!(public_data("no root here 2026-10-31"), None);
    }
}
