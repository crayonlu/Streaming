use reqwest::header::{REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::HashMap;

pub use cookie::BilibiliCookieResult;

// ── Submodules ────────────────────────────────────────────────────────────────
pub(crate) mod category;
pub(crate) mod cookie;
pub(crate) mod featured;
pub(crate) mod replay;
pub(crate) mod room;
pub(crate) mod search;

pub use category::{check_rooms_live, get_categories, get_rooms_by_category};
pub use featured::get_featured;
pub use replay::persist_sessdata;
pub(crate) use room::ensure_buvid;
pub use room::{get_room_detail, get_stream_sources};
pub use search::search_rooms;

// ── Shared constants ─────────────────────────────────────────────────────────
pub(crate) const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
pub(crate) const LIVE_REFERER: &str = "https://live.bilibili.com/";
pub(crate) const FEATURED_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/web-interface/v1/index/getList";
pub(crate) const SEARCH_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/search/type";
pub(crate) const LIVE_SEARCH_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/web-interface/v1/search/liveUsers";
pub(crate) const ROOM_BASE_INFO_ENDPOINT: &str =
    "https://api.live.bilibili.com/room/v1/Room/get_info_by_id";
pub(crate) const ROOM_INIT_ENDPOINT: &str = "https://api.live.bilibili.com/room/v1/Room/room_init";

// ── Shared utility functions ─────────────────────────────────────────────────

pub(crate) fn text_u64(v: Option<u64>) -> Option<String> {
    let number = v?;
    if number >= 10_000 {
        Some(format!("{:.1}万", number as f64 / 10_000.0))
    } else {
        Some(number.to_string())
    }
}

pub(crate) fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

/// Batch fetch room base info to supplement missing title/cover from search results.
/// B站 search API sometimes returns empty title/cover, so we fetch them separately.
pub(crate) async fn fetch_room_base_info_batch(
    client: &reqwest::Client,
    room_ids: &[String],
) -> HashMap<String, (String, String)> {
    let mut result = HashMap::new();
    if room_ids.is_empty() {
        return result;
    }

    // API supports batch IDs via ids[] parameter
    // Response format: { "code": 0, "data": { "room_id": { fields... } } }
    let ids_param: Vec<(&str, String)> = room_ids.iter().map(|id| ("ids[]", id.clone())).collect();

    let payload: Value = match client
        .get(ROOM_BASE_INFO_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .query(&ids_param)
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(v) => v,
            Err(_) => return result,
        },
        Err(_) => return result,
    };

    let data = match payload.get("data") {
        Some(v) => v,
        None => return result,
    };

    if let Some(obj) = data.as_object() {
        for (room_id, room_data) in obj {
            let title = room_data
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            // Prefer room_cover, fall back to user_cover
            let cover = room_data
                .get("room_cover")
                .and_then(Value::as_str)
                .or_else(|| room_data.get("user_cover").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            result.insert(room_id.clone(), (title, cover));
        }
    }
    result
}

pub(crate) fn value_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

pub(crate) fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub(crate) fn normalize_url(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let url = if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_string()
    };
    // Bilibili's hdslb.com CDN blocks requests without the correct Referer.
    // Route these images through our local HTTP image proxy (proxy.rs) which
    // injects Referer: https://live.bilibili.com/ before forwarding upstream.
    if url.contains("hdslb.com") {
        return crate::proxy::proxify(&url);
    }
    url
}
