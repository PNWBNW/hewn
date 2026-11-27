//! What the period proof's hashes depend on in JavaScript, done the same way in Rust: the text
//! `JSON.stringify` writes for a value read by `JSON.parse`, how a number prints, how strings
//! compare, and what `trim()` removes. `@pnw/ledger` hashes entries as `JSON.stringify` of an
//! array, so a verifier has to write the same bytes for anything a proof file can hold.

use serde_json::{Map, Number, Value};

/// `JSON.stringify(value)` for a value `JSON.parse` made. Objects keep their keys in the order
/// JavaScript does: integer-like keys first, ascending, then the rest in the order first written
/// (serde_json's `preserve_order` keeps that order, and, as `JSON.parse`, a repeated key keeps
/// its first place and its last value).
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write(value, &mut out);
    out
}

fn write(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&number(n)),
        Value::String(s) => out.push_str(&string(s)),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            for (i, (k, v)) in ordered(map).into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&string(k));
                out.push(':');
                write(v, out);
            }
            out.push('}');
        }
    }
}

/// An object's keys in JavaScript's order: array indices (0 to 2^32 - 2, written canonically)
/// ascending, then the others in insertion order.
fn ordered(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let index = |k: &str| -> Option<u64> {
        if k.is_empty() || (k.len() > 1 && k.starts_with('0')) || !k.bytes().all(|b| b.is_ascii_digit()) || k.len() > 10 {
            return None;
        }
        k.parse::<u64>().ok().filter(|n| *n < u32::MAX as u64)
    };
    let mut indices: Vec<(u64, &String, &Value)> = map.iter().filter_map(|(k, v)| index(k).map(|n| (n, k, v))).collect();
    indices.sort_by_key(|(n, _, _)| *n);
    let mut out: Vec<(&String, &Value)> = indices.into_iter().map(|(_, k, v)| (k, v)).collect();
    out.extend(map.iter().filter(|(k, _)| index(k).is_none()));
    out
}

/// A string as `JSON.stringify` writes it (serde_json escapes the same characters the same way:
/// `"`, `\`, `\b\f\n\r\t`, other controls as `\u00xx` in lower case; everything else as itself).
pub fn string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

/// A number as JavaScript prints it (`Number.prototype.toString`): the shortest digits that read
/// back as the same double, in plain form from 1e-7 up to 1e21 and in exponent form outside.
pub fn number(n: &Number) -> String {
    match n.as_f64() {
        Some(x) => double(x),
        None => "null".into(),
    }
}

pub fn double(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    if !x.is_finite() {
        return "null".into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // Rust's `{:e}` is the shortest round-trip form: "d.ddde±n".
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    let n = exp.parse::<i64>().unwrap_or(0) + 1; // the decimal point sits after n digits
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign_e = if e >= 0 { "+" } else { "-" };
        let rest = if k > 1 { format!(".{}", &digits[1..]) } else { String::new() };
        format!("{}{rest}e{sign_e}{}", &digits[..1], e.abs())
    };
    format!("{sign}{body}")
}

/// `a < b` as JavaScript compares strings: by UTF-16 code units.
pub fn less(a: &str, b: &str) -> bool {
    a.encode_utf16().lt(b.encode_utf16())
}

/// What JavaScript's `trim()` removes: its white space and line terminators.
pub fn is_js_white(c: char) -> bool {
    crate::chain::js_space(c)
}

/// `!s.trim()`: nothing left once JavaScript trims it.
pub fn blank(s: &str) -> bool {
    s.chars().all(is_js_white)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_as_javascript_prints_them() {
        for (x, js) in [
            (1.0, "1"),
            (7.0, "7"),
            (-3.0, "-3"),
            (0.1, "0.1"),
            (1.5e-7, "1.5e-7"),
            (0.000001, "0.000001"),
            (1e21, "1e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.25e22, "1.25e+22"),
            (-0.0, "0"),
            (9007199254740993.0, "9007199254740992"),
        ] {
            assert_eq!(double(x), js, "{x}");
        }
    }

    #[test]
    fn objects_keep_javascripts_key_order() {
        let v: Value = serde_json::from_str(r#"{"b":1,"a":2,"10":3,"2":4,"01":5,"b":6}"#).unwrap();
        assert_eq!(stringify(&v), r#"{"2":4,"10":3,"b":6,"a":2,"01":5}"#);
    }

    #[test]
    fn strings_escape_as_javascript_escapes_them() {
        let v: Value = serde_json::from_str(r#"["a\"b\\c\n\u0001\u007f é   😀"]"#).unwrap();
        assert_eq!(stringify(&v), "[\"a\\\"b\\\\c\\n\\u0001\u{7f} é \u{2028} 😀\"]");
    }

    #[test]
    fn strings_compare_by_utf16_units() {
        assert!(less("2026-10-25", "2026-10-31"));
        // U+FF5E is above the surrogates that encode U+1F600 in UTF-16, below it in UTF-8.
        assert!(less("😀", "～"));
        assert!(!less("～", "😀"));
    }

    #[test]
    fn trim_matches_javascript() {
        assert!(blank(" \t\u{feff}\u{a0}\u{2028}"));
        assert!(!blank("\u{85}"));
        assert!(!blank(" x "));
    }
}
