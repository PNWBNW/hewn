//! The verifier at a terminal: the same checks as the window.
//!
//!   pnw-verify release <folder> [--key <base64 public key>]... [--anchor] [--endpoint <explorer>]
//!   pnw-verify period <proof.json> [--offline] [--endpoint <explorer>]
//!   pnw-verify anchor <root> <last day of the range> [<anchoring transaction id>] [--endpoint <explorer>]
//!
//! Exits 0 when every check passes, 1 otherwise, 2 on a usage error.

use std::path::Path;
use std::process::ExitCode;

use pnw_verify::chain::HttpExplorer;
use pnw_verify::generated::config;
use pnw_verify::release::{KeyEntry, brand_keys, verify_release};
use pnw_verify::{Report, period};

const USAGE: &str = "Usage:
  pnw-verify release <folder> [--key <base64 public key>]... [--anchor] [--endpoint <explorer>]
  pnw-verify period <proof.json> [--offline] [--endpoint <explorer>]
  pnw-verify anchor <root> <last day of the range> [<anchoring transaction id>] [--endpoint <explorer>]";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut positional = Vec::new();
    let mut keys = Vec::new();
    let mut endpoint = config::ALEO_ENDPOINT.to_string();
    let (mut anchor, mut offline) = (false, false);
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--key" => match it.next() {
                Some(k) => keys.push(KeyEntry::given(k)),
                None => return usage(),
            },
            "--endpoint" => match it.next() {
                Some(e) => endpoint = e,
                None => return usage(),
            },
            "--anchor" => anchor = true,
            "--offline" => offline = true,
            _ if a.starts_with("--") => return usage(),
            _ => positional.push(a),
        }
    }
    let explorer = HttpExplorer::new(&endpoint);
    let report: Report = match positional.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["release", folder] => {
            let keys = if keys.is_empty() { brand_keys() } else { keys };
            verify_release(Path::new(folder), &keys, anchor.then_some(&explorer as _)).report
        }
        ["period", file] => match std::fs::read_to_string(file) {
            Ok(text) => period::verify_proof(&text, (!offline).then_some(&explorer as _)),
            Err(e) => {
                eprintln!("Couldn't read {file}: {e}");
                return ExitCode::from(1);
            }
        },
        ["anchor", root, end] => period::verify_public(root, end, None, &explorer),
        ["anchor", root, end, tx] => period::verify_public(root, end, Some(tx), &explorer),
        _ => return usage(),
    };
    print!("{}", report.text());
    if report.passed() { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

fn usage() -> ExitCode {
    eprintln!("{USAGE}");
    ExitCode::from(2)
}
