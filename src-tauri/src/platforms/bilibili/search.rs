//! Bilibili live room search.

use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::HashMap;

use crate::platforms::http::{retry, shared_client};
use crate::models::{PlatformId, RoomCard};

use super::{
    ensure_buvid, fetch_room_base_info_batch, normalize_url, non_empty, text_u64,
    value_to_string, value_to_u64, DEFAULT_UA, LIVE_REFERER,
    LIVE_SEARCH_ENDPOINT, SEARCH_ENDPOINT,
};
fn strip_em_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '<' {
            // Consume until the closing '>'
            for inner in chars.by_ref() {
                if inner == '>' {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Parse a list of live-search items (works for both `live_room` and `live_user` shapes).
/// The `room_info_map` is used to supplement missing title/cover from batch API.
fn parse_bili_search_items_with_fallback(
    items: &[Value],
    room_info_map: &HashMap<String, (String, String)>,
) -> Vec<RoomCard> {
    let mut cards = Vec::with_capacity(items.len());
    for item in items {
        let room_id = value_to_string(item.get("roomid").or_else(|| item.get("room_id")));
        if room_id.is_empty() {
            continue;
        }

        // Try search result first, then fall back to batch API result
        let raw_title = value_to_string(item.get("title"));
        let fallback_info = room_info_map.get(&room_id);
        let title = if !raw_title.is_empty() {
            raw_title.clone()
        } else {
            fallback_info
                .as_ref()
                .map(|(t, _)| t.clone())
                .unwrap_or_default()
        };

        let streamer_name = strip_em_tags(&value_to_string(
            item.get("uname").or_else(|| item.get("nick_name")),
        ));

        let cover_main = value_to_string(item.get("cover"));
        let cover_fallback = value_to_string(item.get("cover_from_user"));
        let cover_url = if !cover_main.is_empty() {
            normalize_url(&cover_main)
        } else if let Some((_, c)) = fallback_info {
            if !c.is_empty() {
                normalize_url(c)
            } else {
                normalize_url(&cover_fallback)
            }
        } else {
            normalize_url(&cover_fallback)
        };

        let viewers = value_to_u64(item.get("online"))
            .or_else(|| value_to_u64(item.get("online_num")))
            .and_then(|v| text_u64(Some(v)));
        let area_name = item
            .get("cate_name")
            .or_else(|| item.get("area_v2_name"))
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let is_live = item.get("live_status").and_then(Value::as_i64).unwrap_or(1) == 1;

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
    cards
}

async fn search_rooms_once(keyword: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let trimmed = keyword.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let client = shared_client();

    let mut cookie_header = String::new();
    let _ = ensure_buvid(client, &mut cookie_header).await;

    // ── Strategy 1: dedicated live-user search (less risk-controlled) ──────
    let live_search_result = {
        let mut req = client
            .get(LIVE_SEARCH_ENDPOINT)
            .header(USER_AGENT, DEFAULT_UA)
            .header(REFERER, LIVE_REFERER)
            .query(&[
                ("keyword", trimmed),
                ("platform", "pc"),
                ("pn", &page.to_string()),
                ("ps", "30"),
            ]);
        if !cookie_header.is_empty() {
            req = req.header(COOKIE, &cookie_header);
        }
        req.send().await.ok().and_then(|r| {
            if r.status().is_success() {
                Some(r)
            } else {
                None
            }
        })
    };

    if let Some(resp) = live_search_result {
        if let Ok(payload) = resp.json::<Value>().await {
            if payload.get("code").and_then(Value::as_i64).unwrap_or(-1) == 0 {
                let items = payload
                    .get("data")
                    .and_then(|d| d.get("list"))
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                if !items.is_empty() {
                    // Collect room IDs for batch fetch
                    let room_ids: Vec<String> = items
                        .iter()
                        .filter_map(|item| {
                            let s =
                                value_to_string(item.get("roomid").or_else(|| item.get("room_id")));
                            non_empty(s)
                        })
                        .collect();
                    let room_info_map = fetch_room_base_info_batch(client, &room_ids).await;
                    return Ok(parse_bili_search_items_with_fallback(
                        &items,
                        &room_info_map,
                    ));
                }
            }
        }
    }

    // ── Strategy 2: general search API (same as web, with all required params) ─
    let mut request = client
        .get(SEARCH_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .query(&[
            ("context", ""),
            ("search_type", "live"),
            ("cover_type", "user_cover"),
            ("order", ""),
            ("keyword", trimmed),
            ("category_id", ""),
            ("__refresh__", ""),
            ("_extra", ""),
            ("highlight", "0"),
            ("single_column", "0"),
            ("page", &page.to_string()),
        ]);
    if !cookie_header.is_empty() {
        request = request.header(COOKIE, cookie_header);
    }

    let payload: Value = request
        .send()
        .await
        .map_err(|e| format!("bilibili search request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bilibili search status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("bilibili search parse error: {e}"))?;

    if payload.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("bilibili search api error: {msg}"));
    }

    let result = payload
        .get("data")
        .and_then(|d| d.get("result"))
        .cloned()
        .unwrap_or(Value::Null);

    // `live_user` is the authoritative field for live-stream search results;
    // fall back to `live_room` if it is empty.
    let user_items = result
        .get("live_user")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let room_items = result
        .get("live_room")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let source = if !user_items.is_empty() {
        user_items
    } else {
        room_items
    };

    if !source.is_empty() {
        // Collect room IDs for batch fetch to supplement missing title/cover
        let room_ids: Vec<String> = source
            .iter()
            .filter_map(|item| {
                let s = value_to_string(item.get("roomid").or_else(|| item.get("room_id")));
                non_empty(s)
            })
            .collect();
        let room_info_map = fetch_room_base_info_batch(client, &room_ids).await;
        return Ok(parse_bili_search_items_with_fallback(
            &source,
            &room_info_map,
        ));
    }

    Ok(vec![])
}

pub async fn search_rooms(keyword: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let kw = keyword.to_owned();
    retry(2, || search_rooms_once(&kw, page)).await
}

