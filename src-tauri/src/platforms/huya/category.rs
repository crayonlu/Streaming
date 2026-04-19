use serde_json::Value;

use super::{normalize_url, text_u64, value_to_string, value_to_u64, DESKTOP_UA};
use crate::models::{Category, PlatformId, RoomCard};
use crate::platforms::http::shared_client;

const PAGE_SIZE: u32 = 30;
const GAME_LIST_ENDPOINT: &str = "https://www.huya.com/cache.php";

pub async fn get_categories() -> Result<Vec<Category>, String> {
    let payload: Value = shared_client()
        .get(GAME_LIST_ENDPOINT)
        .header("User-Agent", DESKTOP_UA)
        .header("Referer", "https://www.huya.com/g")
        .query(&[("m", "Game"), ("do", "getGameList")])
        .send()
        .await
        .map_err(|e| format!("huya game list request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("huya game list status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("huya game list parse error: {e}"))?;

    let status = payload.get("status").and_then(Value::as_i64).unwrap_or(0);
    if status != 200 {
        return Err(format!("huya game list api status: {status}"));
    }

    let games = payload
        .get("gameList")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(games
        .iter()
        .filter_map(|game| {
            let gid = value_to_string(game.get("gid"));
            let name = value_to_string(game.get("gameFullName"));
            if gid.is_empty() || name.is_empty() {
                return None;
            }

            let host = value_to_string(game.get("gameHostName"));
            Some(Category {
                id: gid.clone(),
                name,
                parent_id: None,
                icon_url: None,
                short_name: Some(if host.is_empty() { gid } else { host }),
            })
        })
        .collect())
}

fn map_live_item(item: &Value) -> Option<RoomCard> {
    let room_id = value_to_string(item.get("lProfileRoom").or_else(|| item.get("room_id")));
    if room_id.is_empty() || room_id == "0" {
        return None;
    }

    let cover_url = normalize_url(&value_to_string(
        item.get("sScreenshot")
            .or_else(|| item.get("room_cover"))
            .or_else(|| item.get("sRoomImage")),
    ));
    let viewer_count_text = item
        .get("viewer_count_str")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| text_u64(value_to_u64(item.get("lUserCount"))));

    Some(RoomCard {
        id: format!("huya-{room_id}"),
        platform: PlatformId::Huya,
        room_id,
        title: value_to_string(item.get("sIntroduction").or_else(|| item.get("title"))),
        streamer_name: value_to_string(item.get("sNick").or_else(|| item.get("nickname"))),
        cover_url,
        area_name: item
            .get("sGameFullName")
            .or_else(|| item.get("gameFullName"))
            .and_then(Value::as_str)
            .map(|s| s.to_string()),
        viewer_count_text,
        is_live: true,
        followed: false,
    })
}

async fn fetch_rooms_by_gid(gid: &str, page: u32) -> Result<Vec<RoomCard>, String> {
    let client = shared_client();
    let payload: Value = client
        .get("https://live.huya.com/liveHttpUI/getLiveList")
        .header("User-Agent", DESKTOP_UA)
        .header("Referer", "https://www.huya.com/")
        .query(&[
            ("iGid", gid),
            ("iPageNo", &page.to_string()),
            ("iPageSize", &PAGE_SIZE.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("huya category rooms request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("huya category rooms status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("huya category rooms parse error: {e}"))?;

    let error = payload.get("error").and_then(Value::as_i64).unwrap_or(0);
    if error != 0 {
        let msg = payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("huya category rooms api error: {msg}"));
    }

    let items = payload
        .get("data")
        .and_then(|d| d.get("vList"))
        .or_else(|| payload.get("vList"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(items.iter().filter_map(map_live_item).collect())
}

pub async fn get_rooms_by_category(
    category_id: &str,
    _parent_id: Option<&str>,
    page: u32,
) -> Result<Vec<RoomCard>, String> {
    fetch_rooms_by_gid(category_id, page).await
}

pub async fn check_rooms_live(room_ids: &[String]) -> std::collections::HashMap<String, bool> {
    let mut result = std::collections::HashMap::new();
    for rid in room_ids {
        let is_live = super::room::fetch_room_detail_payload(rid)
            .await
            .map(|detail| detail.is_live)
            .unwrap_or(false);
        result.insert(rid.clone(), is_live);
    }
    result
}
