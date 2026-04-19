use serde_json::Value;

pub(crate) mod category;
pub(crate) mod featured;
pub(crate) mod room;
pub(crate) mod search;

pub(crate) const DESKTOP_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0";
pub(crate) const MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

pub(crate) fn value_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

pub(crate) fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

pub(crate) fn text_u64(v: Option<u64>) -> Option<String> {
    let number = v?;
    if number >= 10_000 {
        Some(format!("{:.1}万", number as f64 / 10_000.0))
    } else {
        Some(number.to_string())
    }
}

pub(crate) fn normalize_url(raw: &str) -> String {
    if raw.is_empty() {
        String::new()
    } else if raw.starts_with("http://") {
        format!("https://{}", &raw["http://".len()..])
    } else if raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_string()
    }
}
