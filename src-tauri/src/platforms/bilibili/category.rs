use md5::{Digest, Md5};
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use super::super::http::shared_client;
use super::{
    normalize_url, text_u64, value_to_string, value_to_u64, DEFAULT_UA, LIVE_REFERER,
    ROOM_INIT_ENDPOINT,
};
use crate::models::{Category, PlatformId, RoomCard};

// ── Internal helpers for category API signing ────────────────────────────────

/// Generate a `w_webid` (also called `access_id`) by fetching the Bilibili
/// live page and extracting the embedded `access_id` from the server-rendered
/// HTML. This is required for the `/second/getList` API signing.
async fn generate_w_webid() -> Result<String, String> {
    let client = shared_client();
    let resp = client
        .get("https://live.bilibili.com/lol")
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("w_webid request failed: {e}"))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("w_webid read body failed: {e}"))?;

    // Search for "access_id":"<value>" in the HTML
    let needle = "\"access_id\":\"";
    if let Some(idx) = text.find(needle) {
        let slice = &text[idx + needle.len()..];
        if let Some(end) = slice.find('"') {
            let id = slice[..end].to_string();
            if !id.is_empty() {
                return Ok(id);
            }
        }
    }

    // Fallback: try with space after colon
    let needle2 = "\"access_id\": \"";
    if let Some(idx) = text.find(needle2) {
        let slice = &text[idx + needle2.len()..];
        if let Some(end) = slice.find('"') {
            let id = slice[..end].to_string();
            if !id.is_empty() {
                return Ok(id);
            }
        }
    }

    Err("Failed to extract w_webid (access_id) from Bilibili live page".to_string())
}

/// Sign parameters for the Bilibili `/second/getList` endpoint.
/// Uses MD5(params_sorted + secret) following DTV's approach.
fn sign_live_list_params(
    area_id: &str,
    parent_area_id: &str,
    page: u32,
    w_webid: &str,
    wts: i64,
) -> (Vec<(String, String)>, String) {
    // Parameters must be in alphabetical order for the signature
    let pairs = vec![
        ("area_id", area_id.to_string()),
        ("page", page.to_string()),
        ("parent_area_id", parent_area_id.to_string()),
        ("platform", "web".to_string()),
        ("sort_type", String::new()),
        ("vajra_business_key", String::new()),
        ("w_webid", w_webid.to_string()),
        ("web_location", "444.253".to_string()),
        ("wts", wts.to_string()),
    ];

    let secret = "ea1db124af3c7062474693fa704f4ff8";
    let sign_string = format!(
        "{}{}",
        pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&"),
        secret
    );
    let mut hasher = Md5::new();
    hasher.update(sign_string.as_bytes());
    let w_rid = format!("{:x}", hasher.finalize());

    let params: Vec<(String, String)> =
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();

    (params, w_rid)
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Fetch Bilibili live categories from `/room/v1/Area/getList`.
pub async fn get_categories() -> Result<Vec<Category>, String> {
    let client = shared_client();
    let payload: Value = client
        .get("https://api.live.bilibili.com/room/v1/Area/getList")
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", LIVE_REFERER)
        .query(&[("need_entrance", "1"), ("parent_id", "0")])
        .send()
        .await
        .map_err(|e| format!("bilibili categories request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bilibili categories status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("bilibili categories parse error: {e}"))?;

    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut categories = Vec::new();
    for parent in &data {
        let parent_id = value_to_string(parent.get("id"));
        let parent_name = parent
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        categories.push(Category {
            id: parent_id.clone(),
            name: parent_name,
            parent_id: None,
            icon_url: None,
            short_name: None,
        });

        if let Some(list) = parent.get("list").and_then(Value::as_array) {
            for area in list {
                // B站 API returns sub-category id as string (e.g. "86"), not number
                let area_id = value_to_string(area.get("id"));
                let area_name = area
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let pic = area
                    .get("pic")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(|s| {
                        if s.starts_with("//") {
                            format!("https:{s}")
                        } else {
                            s.to_string()
                        }
                    });
                categories.push(Category {
                    id: area_id,
                    name: area_name,
                    parent_id: Some(parent_id.clone()),
                    icon_url: pic,
                    short_name: None,
                });
            }
        }
    }
    Ok(categories)
}

/// Fetch rooms filtered by Bilibili category area.
///
/// - `area_id`: the category ID to filter by.
/// - `parent_id`: if `Some`, this is a sub-category query — `area_id` is the sub-area
///   and `parent_id` is its parent. If `None`, this is a parent-category query and
///   `area_id` is used as `parent_area_id` with `area_id=0` to fetch all sub-areas.
pub async fn get_rooms_by_category(
    area_id: &str,
    parent_id: Option<&str>,
    page: u32,
) -> Result<Vec<RoomCard>, String> {
    let (parent_area_id, area_id_param) = match parent_id {
        Some(pid) => (pid.to_string(), area_id.to_string()),
        None => (area_id.to_string(), "0".to_string()),
    };

    // The /second/getList endpoint requires WBI signing.
    // 1. Generate w_webid by fetching a live page
    // 2. Build params, compute MD5 signature (w_rid + wts)
    // 3. Send request with buvid3 cookie and all signed params
    let w_webid = generate_w_webid().await?;

    let wts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("time error: {e}"))?
        .as_secs() as i64;

    let (mut params, w_rid) =
        sign_live_list_params(&area_id_param, &parent_area_id, page, &w_webid, wts);
    params.push(("w_rid".to_string(), w_rid));

    let client = shared_client();
    let payload: Value = client
        .get("https://api.live.bilibili.com/xlive/web-interface/v1/second/getList")
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .header(COOKIE, "buvid3=i;")
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("bilibili category rooms request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bilibili category rooms status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("bilibili category rooms parse error: {e}"))?;

    // Check for API-level errors (e.g. -352 risk control)
    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let msg = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        return Err(format!(
            "bilibili category rooms API error: code={code}, message={msg}"
        ));
    }

    let mut cards = Vec::new();
    let items = payload
        .get("data")
        .and_then(|d| d.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for item in items {
        let room_id = value_to_string(item.get("roomid"));
        if room_id.is_empty() {
            continue;
        }
        cards.push(RoomCard {
            id: format!("bilibili-{room_id}"),
            platform: PlatformId::Bilibili,
            room_id,
            title: value_to_string(item.get("title")),
            streamer_name: value_to_string(item.get("uname")),
            cover_url: normalize_url(&value_to_string(item.get("cover"))),
            area_name: item
                .get("area_name")
                .and_then(Value::as_str)
                .map(|s| s.to_string()),
            viewer_count_text: text_u64(value_to_u64(item.get("online"))),
            is_live: true,
            followed: false,
        });
    }
    Ok(cards)
}

/// Batch-check whether a list of rooms are currently live.
pub async fn check_rooms_live(room_ids: &[String]) -> HashMap<String, bool> {
    let client = shared_client();
    let mut result = HashMap::new();

    for chunk in room_ids.chunks(50) {
        let ids_param = chunk.join(",");
        let resp = client
            .get(ROOM_INIT_ENDPOINT)
            .header(USER_AGENT, DEFAULT_UA)
            .header(REFERER, LIVE_REFERER)
            .query(&[("id", &ids_param)])
            .send()
            .await;

        if let Ok(resp) = resp {
            if let Ok(payload) = resp.json::<Value>().await {
                if let Some(data) = payload.get("data").and_then(Value::as_object) {
                    for (rid, info) in data {
                        let live =
                            info.get("live_status").and_then(Value::as_i64).unwrap_or(0) == 1;
                        result.insert(rid.clone(), live);
                    }
                }
            }
        }
    }

    result
}
