//! Douyu live room search.

use serde_json::Value;

use crate::models::{PlatformId, RoomCard};
use crate::platforms::http::{retry, shared_client};

use super::{normalize_url, text_u64, value_to_string, value_to_u64, DEFAULT_UA, SEARCH_ENDPOINT};
async fn search_rooms_once(keyword: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let trimmed = keyword.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let did = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("time error: {e}"))?
            .as_nanos()
    );

    let client = shared_client();

    let payload: Value = client
        .get(SEARCH_ENDPOINT)
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", "https://www.douyu.com/search/")
        .header("Cookie", format!("dy_did={did}; acf_did={did}"))
        .query(&[
            ("kw", trimmed),
            ("page", &page.to_string()),
            ("pageSize", "20"),
            ("filterType", "0"),
        ])
        .send()
        .await
        .map_err(|e| format!("douyu search request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("douyu search status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("douyu search parse error: {e}"))?;

    if payload.get("error").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("douyu search api error: {msg}"));
    }

    let data = payload.get("data").cloned().unwrap_or(Value::Null);

    // The `searchUser` API can return results in two shapes depending on version:
    //   1. `relateUser: [{ anchorInfo: { rid, rn, nn, … } }]`  (nested)
    //   2. `list: [{ rid, roomName, nickname, … }]`            (flat)
    // Try both so we gracefully handle API changes.
    let relate_users = data
        .get("relateUser")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let flat_list = data
        .get("list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut cards = Vec::new();

    // Shape 1: nested anchorInfo
    for user in &relate_users {
        let anchor = user.get("anchorInfo").unwrap_or(&Value::Null);
        let room_id = value_to_string(anchor.get("rid"));
        if room_id.is_empty() {
            continue;
        }
        let title = value_to_string(anchor.get("rn").or_else(|| anchor.get("roomName")));
        let streamer_name = value_to_string(anchor.get("nn").or_else(|| anchor.get("nickName")));
        let cover_url = normalize_url(&value_to_string(
            anchor.get("roomSrc").or_else(|| anchor.get("avatar")),
        ));
        let area_name = anchor
            .get("cateName")
            .or_else(|| anchor.get("c2name"))
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let viewers =
            text_u64(value_to_u64(anchor.get("ol")).or_else(|| value_to_u64(anchor.get("hn"))));
        let is_live = anchor.get("isLive").and_then(Value::as_i64).unwrap_or(1) == 1;

        cards.push(RoomCard {
            id: format!("douyu-{room_id}"),
            platform: PlatformId::Douyu,
            room_id,
            title,
            streamer_name,
            cover_url,
            area_name,
            viewer_count_text: viewers,
            is_live,
            followed: false,
        });
    }

    // Shape 2: flat list (only used when relateUser was empty)
    if cards.is_empty() {
        for item in &flat_list {
            let room_id = value_to_string(item.get("rid").or_else(|| item.get("roomId")));
            if room_id.is_empty() {
                continue;
            }
            let title = value_to_string(item.get("roomName").or_else(|| item.get("rn")));
            let streamer_name = value_to_string(item.get("nickname").or_else(|| item.get("nn")));
            let cover_url = normalize_url(&value_to_string(
                item.get("roomSrc").or_else(|| item.get("avatar")),
            ));
            let area_name = item
                .get("cateName")
                .or_else(|| item.get("c2name"))
                .and_then(Value::as_str)
                .map(|s| s.to_string());
            let viewers =
                text_u64(value_to_u64(item.get("hn")).or_else(|| value_to_u64(item.get("ol"))));
            let is_live = item.get("isLive").and_then(Value::as_i64).unwrap_or(1) == 1;

            cards.push(RoomCard {
                id: format!("douyu-{room_id}"),
                platform: PlatformId::Douyu,
                room_id,
                title,
                streamer_name,
                cover_url,
                area_name,
                viewer_count_text: viewers,
                is_live,
                followed: false,
            });
        }
    }

    Ok(cards)
}

pub async fn search_rooms(keyword: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let kw = keyword.to_owned();
    retry(2, || search_rooms_once(&kw, page)).await
}
