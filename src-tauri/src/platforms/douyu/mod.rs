use serde_json::Value;

// ── Submodules ────────────────────────────────────────────────────────────────
pub(crate) mod category;
pub(crate) mod featured;
pub(crate) mod replay;
pub(crate) mod room;
pub(crate) mod search;

pub use category::{check_rooms_live, get_categories, get_rooms_by_category};
pub use featured::get_featured;
pub use replay::{get_replay_list, get_replay_parts, get_replay_qualities};
pub use room::{get_room_detail, get_stream_sources};
pub use search::search_rooms;

// ── Shared constants ─────────────────────────────────────────────────────────
pub(crate) const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
pub(crate) const SEARCH_ENDPOINT: &str = "https://www.douyu.com/japi/search/api/searchUser";
pub(crate) const DEFAULT_DOUYU_DID: &str = "10000000000000000000000000001501";
pub(crate) const DEFAULT_DOUYU_CDN: &str = "ws-h5";
pub(crate) const CRYPTO_JS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/platforms/douyu/cryptojs.min.js"
));

// ── Shared utility functions ─────────────────────────────────────────────────

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

pub(crate) fn value_to_i32(value: &Value) -> Option<i32> {
    match value {
        Value::Number(num) => num.as_i64().map(|n| n as i32),
        Value::String(s) => s.parse::<i32>().ok(),
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
        return String::new();
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with("//") {
        format!("https:{}", raw)
    } else {
        raw.to_string()
    }
}
