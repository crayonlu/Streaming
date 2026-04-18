//! Douyu featured (popular) rooms.

use serde_json::Value;

use crate::models::{PlatformId, RoomCard};
use crate::platforms::http::{retry, shared_client};

use super::{normalize_url, text_u64, value_to_string, value_to_u64, DEFAULT_UA};
async fn get_featured_once(page: u32) -> Result<Vec<RoomCard>, String> {
    let client = shared_client();

    let endpoint = format!("https://www.douyu.com/gapi/rkc/directory/mixListV1/0_0/{page}");

    let payload: Value = client
        .get(&endpoint)
        .header("User-Agent", DEFAULT_UA)
        .query(&[("limit", "30")])
        .send()
        .await
        .map_err(|e| format!("douyu featured request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("douyu featured status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("douyu featured parse error: {e}"))?;

    if payload.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("douyu featured api error: {msg}"));
    }

    let mut cards = Vec::new();
    let items = payload
        .get("data")
        .and_then(|d| d.get("rl"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for item in items {
        let room_id = value_to_string(item.get("rid"));
        if room_id.is_empty() {
            continue;
        }

        let title = value_to_string(item.get("rn").or_else(|| item.get("roomName")));
        let streamer_name = value_to_string(item.get("nn").or_else(|| item.get("nickName")));
        let cover_url = normalize_url(&value_to_string(
            item.get("rs16").or_else(|| item.get("roomSrc")),
        ));
        let area_name = item
            .get("c2name")
            .or_else(|| item.get("cateName"))
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let viewers = text_u64(
            value_to_u64(item.get("ol"))
                .or_else(|| value_to_u64(item.get("hn")))
                .or_else(|| {
                    item.get("hn")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                        .and_then(|s| s.replace('万', "").parse::<f64>().ok())
                        .map(|f| (f * 10_000.0) as u64)
                }),
        );
        let is_live = item.get("type").and_then(Value::as_i64).unwrap_or(1) == 1;

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

    Ok(cards)
}

pub async fn get_featured(page: u32) -> Result<Vec<RoomCard>, String> {
    let p = page;
    retry(2, || get_featured_once(p)).await
}
