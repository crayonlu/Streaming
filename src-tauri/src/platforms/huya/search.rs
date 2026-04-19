use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, ORIGIN, REFERER, USER_AGENT};
use serde_json::Value;

use super::{normalize_url, value_to_string, DESKTOP_UA};
use crate::models::{PlatformId, RoomCard};
use crate::platforms::http::shared_client;

pub async fn search_rooms(keyword: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let trimmed = keyword.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let start = page.saturating_sub(1) * 20;
    let payload: Value = shared_client()
        .get("https://search.cdn.huya.com/")
        .header(USER_AGENT, DESKTOP_UA)
        .header(REFERER, "https://www.huya.com/search/")
        .header(ORIGIN, "https://www.huya.com")
        .header(ACCEPT, "*/*")
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9")
        .query(&[
            ("m", "Search"),
            ("do", "getSearchContent"),
            ("q", trimmed),
            ("uid", "0"),
            ("v", "1"),
            ("typ", "-5"),
            ("livestate", "0"),
            ("rows", "20"),
            ("start", &start.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("huya search request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("huya search status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("huya search parse error: {e}"))?;

    let docs = payload
        .get("response")
        .and_then(|r| r.get("1"))
        .and_then(|d| d.get("docs"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut cards = Vec::new();
    for item in docs {
        let room_id = value_to_string(item.get("room_id"));
        if room_id.is_empty() || room_id == "0" {
            continue;
        }

        cards.push(RoomCard {
            id: format!("huya-{room_id}"),
            platform: PlatformId::Huya,
            room_id,
            title: value_to_string(item.get("live_intro")),
            streamer_name: value_to_string(item.get("game_nick")),
            cover_url: normalize_url(&value_to_string(
                item.get("game_screenshot")
                    .or_else(|| item.get("game_avatarUrl180")),
            )),
            area_name: item
                .get("game_name")
                .and_then(Value::as_str)
                .map(|s| s.to_string()),
            viewer_count_text: None,
            is_live: item
                .get("gameLiveOn")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            followed: false,
        });
    }

    Ok(cards)
}
