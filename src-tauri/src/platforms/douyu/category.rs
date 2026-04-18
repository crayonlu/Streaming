use serde_json::Value;

use super::super::http::shared_client;
use super::{normalize_url, text_u64, value_to_string, value_to_u64, DEFAULT_UA};
use crate::models::{Category, PlatformId, RoomCard};

// ── Public API ───────────────────────────────────────────────────────────────

/// Fetch Douyu categories from mobile API.
///
/// Returns a flat list where each sub-category carries a `parent_id` pointing
/// to its parent (cate1) and an optional `short_name` used as the API slug.
pub async fn get_categories() -> Result<Vec<Category>, String> {
    let client = shared_client();
    let payload: Value = client
        .get("https://m.douyu.com/api/cate/list")
        .header("User-Agent", DEFAULT_UA)
        .send()
        .await
        .map_err(|e| format!("douyu categories request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("douyu categories status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("douyu categories parse error: {e}"))?;

    let data = payload.get("data").cloned().unwrap_or_default();

    // API returns { cate1Info: [...], cate2Info: [...] } (flat structure)
    let cate1_list = data
        .get("cate1Info")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let cate2_list = data
        .get("cate2Info")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut categories = Vec::new();

    // Parent categories (cate1)
    for cate1 in &cate1_list {
        let cate1_id = cate1.get("cate1Id").and_then(Value::as_i64).unwrap_or(0);
        let cate1_name = cate1
            .get("cate1Name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let short_name = cate1
            .get("shortName")
            .and_then(Value::as_str)
            .map(|s| s.to_string());

        categories.push(Category {
            id: cate1_id.to_string(),
            name: cate1_name,
            parent_id: None,
            icon_url: None,
            short_name,
        });
    }

    // Sub-categories (cate2) — linked to parent via cate1Id
    for cate2 in &cate2_list {
        let cate1_id = cate2.get("cate1Id").and_then(Value::as_i64).unwrap_or(0);
        let cate2_id = cate2.get("cate2Id").and_then(Value::as_i64).unwrap_or(0);
        let cate2_name = cate2
            .get("cate2Name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let short_name = cate2
            .get("shortName")
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let icon = cate2
            .get("icon")
            .or_else(|| cate2.get("pic"))
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
            id: cate2_id.to_string(),
            name: cate2_name,
            parent_id: Some(cate1_id.to_string()),
            icon_url: icon,
            short_name,
        });
    }

    Ok(categories)
}

/// Fetch rooms filtered by Douyu category.
///
/// `short_name` is the cate2 slug (e.g. "LOL", "wzry") used by the
/// mobile API — **not** the numeric cate2 id.
pub async fn get_rooms_by_category(short_name: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let offset = (page - 1) * 30;
    let url = format!(
        "https://m.douyu.com/hgapi/live/cate/newRecList?offset={offset}&cate2={short_name}&limit=30"
    );
    eprintln!(
        "[douyu] get_rooms_by_category: short_name={short_name}, page={page}, offset={offset}"
    );

    let client = shared_client();
    let resp = client
        .get(&url)
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", "https://m.douyu.com/")
        .send()
        .await
        .map_err(|e| format!("douyu category rooms request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("douyu category rooms HTTP {status}"));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("douyu read body: {e}"))?;
    let payload: Value = serde_json::from_str(&text).map_err(|e| {
        eprintln!(
            "[douyu] JSON parse error. Body preview: {}",
            &text[..text.len().min(500)]
        );
        format!("douyu category rooms parse error: {e}")
    })?;

    let error_code = payload.get("error").and_then(Value::as_i64).unwrap_or(-1);
    if error_code != 0 {
        let msg = payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        eprintln!("[douyu] API error: error={error_code}, msg={msg}, short_name={short_name}");
        return Ok(vec![]);
    }

    let mut cards = Vec::new();
    let items = payload
        .get("data")
        .and_then(|d| d.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    eprintln!(
        "[douyu] got {} rooms for short_name={short_name}",
        items.len()
    );

    for item in items {
        let room_id = value_to_string(item.get("rid"));
        if room_id.is_empty() {
            continue;
        }
        // API returns viewer count as string "hn" (e.g. "101.8万") or numeric "ol"
        let viewer_text = item
            .get("hn")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .or_else(|| text_u64(value_to_u64(item.get("ol"))));
        // API returns area name as "cate2Name" or "cate2ShortName"
        let area_name = item
            .get("cate2Name")
            .or_else(|| item.get("cate2ShortName"))
            .and_then(Value::as_str)
            .map(|s| s.to_string());

        cards.push(RoomCard {
            id: format!("douyu-{room_id}"),
            platform: PlatformId::Douyu,
            room_id,
            title: value_to_string(item.get("roomName")),
            streamer_name: value_to_string(item.get("nickname")),
            cover_url: normalize_url(&value_to_string(item.get("roomSrc"))),
            area_name,
            viewer_count_text: viewer_text,
            is_live: true,
            followed: false,
        });
    }
    Ok(cards)
}

/// Batch-check whether a list of rooms are currently live.
pub async fn check_rooms_live(room_ids: &[String]) -> std::collections::HashMap<String, bool> {
    let client = shared_client();
    let mut result = std::collections::HashMap::new();

    for rid in room_ids {
        let resp = client
            .get(format!("https://www.douyu.com/betard/{rid}"))
            .header("User-Agent", DEFAULT_UA)
            .header("Referer", format!("https://www.douyu.com/{rid}"))
            .send()
            .await;

        if let Ok(resp) = resp {
            if let Ok(payload) = resp.json::<Value>().await {
                let is_live = payload
                    .get("room")
                    .and_then(|r| r.get("show_status"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    == 1;
                result.insert(rid.clone(), is_live);
            }
        }
    }

    result
}
