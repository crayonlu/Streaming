//! Bilibili featured (popular) rooms.

use reqwest::header::{REFERER, USER_AGENT};
use serde_json::Value;

use crate::models::{PlatformId, RoomCard};
use crate::platforms::http::{retry, shared_client};

use super::{
    normalize_url, text_u64, value_to_string, value_to_u64, DEFAULT_UA, FEATURED_ENDPOINT,
};
async fn get_featured_once(page: u32) -> Result<Vec<RoomCard>, String> {
    let client = shared_client();

    let payload: Value = client
        .get(FEATURED_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, "https://www.bilibili.com/")
        .query(&[
            ("platform", "web"),
            ("parent_area_id", "0"),
            ("area_id", "0"),
            ("sort_type", "online"),
            ("page", &page.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("bilibili featured request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bilibili featured status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("bilibili featured parse error: {e}"))?;

    if payload.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("bilibili featured api error: {msg}"));
    }

    let mut cards = Vec::new();
    let sections = payload
        .get("data")
        .and_then(|d| d.get("room_list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for section in sections {
        let Some(items) = section.get("list").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let room_id = value_to_string(item.get("roomid"));
            if room_id.is_empty() {
                continue;
            }

            let title = value_to_string(item.get("title"));
            let streamer_name = value_to_string(item.get("uname"));
            let cover_main = value_to_string(item.get("cover"));
            let cover_fallback = value_to_string(item.get("keyframe"));
            let cover_url = normalize_url(if cover_main.is_empty() {
                &cover_fallback
            } else {
                &cover_main
            });
            let viewers = text_u64(value_to_u64(item.get("online")));
            let area_name = item
                .get("area_v2_name")
                .and_then(Value::as_str)
                .map(|s| s.to_string());
            let is_live = item.get("status").and_then(Value::as_i64).unwrap_or(1) == 1;

            cards.push(RoomCard {
                id: format!("bilibili-{room_id}"),
                platform: PlatformId::Bilibili,
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

pub async fn get_featured(page: u32) -> Result<Vec<RoomCard>, String> {
    let p = page;
    retry(2, || get_featured_once(p)).await
}
