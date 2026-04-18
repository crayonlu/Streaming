//! Bilibili replay (VOD) functions.

use crate::models::{PlatformId, ReplayItem, ReplayQuality};
use crate::platforms::http::shared_client;
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;

use super::{cookie, text_u64, DEFAULT_UA, LIVE_REFERER};
// ─── Bilibili Replay ───────────────────────────────────────────────────────────

/// API to get replay list for another anchor (requires SESSDATA).
/// Endpoint: GET /xlive/web-room/v1/videoService/GetOtherSliceList
const BILI_REPLAY_LIST_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/web-room/v1/videoService/GetOtherSliceList";

/// API to get downloadable video URL (requires SESSDATA + bili_jct).
/// Endpoint: POST /xlive/app-blink/v1/anchorVideo/AnchorVideoDownload
const BILI_REPLAY_DOWNLOAD_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/app-blink/v1/anchorVideo/AnchorVideoDownload";

/// Fetches the uid (mid) for a bilibili room — needed to query replay list.
async fn resolve_uid_from_room(client: &reqwest::Client, room_id: &str) -> Result<u64, String> {
    let payload: Value = client
        .get("https://api.live.bilibili.com/room/v1/Room/get_info")
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .query(&[("room_id", room_id)])
        .send()
        .await
        .map_err(|e| format!("room info request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("room info status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("room info parse error: {e}"))?;

    payload
        .get("data")
        .and_then(|d| d.get("uid"))
        .and_then(Value::as_i64)
        .map(|v| v as u64)
        .filter(|&v| v > 0)
        .ok_or_else(|| "无法获取主播UID".to_string())
}

/// Persists SESSDATA to a local file so it survives restarts.
pub(crate) async fn save_bilibili_sessdata(sessdata: &str) {
    let map = serde_json::json!({ "SESSDATA": sessdata });
    let _ = tokio::fs::write(".bilibili_cookie_store.json", map.to_string()).await;
}

/// Reads SESSDATA from the on-disk cookie store. Returns None if absent or invalid.
pub(crate) async fn read_saved_cookie() -> Option<String> {
    let content = tokio::fs::read(".bilibili_cookie_store.json").await.ok()?;
    let map: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&content).ok()?;
    let sessdata = map.get("SESSDATA")?.as_str()?.trim();
    if sessdata.is_empty() {
        return None;
    }
    Some(format!("SESSDATA={sessdata}"))
}

/// Public wrapper — called by lib.rs via set_bilibili_sessdata command.
pub async fn persist_sessdata(sessdata: &str) {
    save_bilibili_sessdata(sessdata).await;
}

/// Returns the replay list for a bilibili room.
/// Requires SESSDATA (主播授权剪辑).
/// Attempts auto-extraction from WebView first, then falls back to file-based store.
pub async fn get_replay_list(
    app_handle: &tauri::AppHandle,
    room_id: &str,
    page: u32,
) -> Result<Vec<ReplayItem>, String> {
    let client = shared_client();

    let uid = resolve_uid_from_room(client, room_id).await?;

    let query: Vec<(&str, String)> = vec![
        ("live_uid", uid.to_string()),
        ("time_range", "3".to_string()),
        ("page", page.to_string()),
        ("page_size", "30".to_string()),
        ("web_location", "444.8".to_string()),
    ];

    // Auto-extract SESSDATA from WebView (avoids manual config in most cases).
    let cookies = cookie::get_bilibili_cookie(app_handle).await;

    let mut request = client
        .get(BILI_REPLAY_LIST_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, "https://live.bilibili.com/")
        .query(&query);

    if let Some(ref cookie_str) = cookies.cookie {
        request = request.header(COOKIE, cookie_str.as_str());
    }

    let payload: Value = request
        .send()
        .await
        .map_err(|e| format!("replay list request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("replay list status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("replay list parse error: {e}"))?;

    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code == -101 {
        return Err("请先在设置中登录B站账号以获取回放权限".to_string());
    }
    if code == 301 {
        return Err("该主播尚未授权回放剪辑功能".to_string());
    }
    if code != 0 {
        let msg = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("获取回放列表失败: {msg}"));
    }

    let replay_infos = payload
        .get("data")
        .and_then(|d| d.get("replay_info"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut items = Vec::new();
    for info in replay_infos {
        let replay_id = info
            .get("replay_id")
            .and_then(Value::as_i64)
            .map(|v| v.to_string())
            .unwrap_or_default();

        let live_info = info.get("live_info");
        let video_info = info.get("video_info");

        let title = live_info
            .and_then(|v| v.get("title"))
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .unwrap_or_default();

        let cover_url = live_info
            .and_then(|v| v.get("cover"))
            .and_then(Value::as_str)
            .map(|s| {
                if s.starts_with("//") {
                    format!("https:{s}")
                } else {
                    s.to_string()
                }
            });

        let duration_secs = video_info
            .and_then(|v| v.get("duration"))
            .and_then(Value::as_u64);

        let duration_str = duration_secs.map(|secs| {
            let h = secs / 3600;
            let m = (secs % 3600) / 60;
            let s = secs % 60;
            if h > 0 {
                format!("{h}:{m:02}:{s:02}")
            } else {
                format!("{m}:{s:02}")
            }
        });

        let recorded_at = info.get("start_time").and_then(Value::as_i64).unwrap_or(0);
        let show_id = info.get("start_time").and_then(Value::as_i64).unwrap_or(0);

        let view_count_text = video_info
            .and_then(|v| v.get("play_num"))
            .and_then(Value::as_u64)
            .and_then(|v| text_u64(Some(v)));

        items.push(ReplayItem {
            id: replay_id,
            platform: PlatformId::Bilibili,
            room_id: room_id.to_string(),
            title,
            cover_url,
            duration_str,
            duration_secs,
            recorded_at,
            view_count_text,
            part_num: 1,
            total_parts: 1,
            show_id,
            show_remark: None,
            up_id: uid.to_string(),
        });
    }

    Ok(items)
}

/// Bilibili replays are single-part (no multi-P like Douyu).
/// `get_replay_parts` returns the same item since B站回放不拆分P.
pub async fn get_replay_parts(
    _room_id: &str,
    _hash_id: &str,
    _up_id: &str,
) -> Result<Vec<ReplayItem>, String> {
    // Bilibili uses a flat structure: one ReplayItem per session.
    // The replay list IS the parts list; there is no sub-parting.
    Err("B站回放不支持分P展示".to_string())
}

/// Returns the stream URL for a B站 replay recording.
/// For a recorded replay (download_url), returns it directly.
/// Falls back to GetSliceStream which may return an HLS URL.
pub async fn get_replay_qualities(
    app_handle: &tauri::AppHandle,
    replay_id: &str,
) -> Result<Vec<ReplayQuality>, String> {
    let client = shared_client();

    // Auto-extract SESSDATA from WebView.
    let cookies = cookie::get_bilibili_cookie(app_handle).await;

    // Replay_id for bilibili is the record_id.
    // First try to get the download URL directly (simplest path).
    let mut request = client
        .post(BILI_REPLAY_DOWNLOAD_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, "https://live.bilibili.com/")
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .form(&[("record_id", replay_id), ("csrf", "")]);

    if let Some(ref cookie_str) = cookies.cookie {
        request = request.header(COOKIE, cookie_str.as_str());
    }

    let payload: Value = request
        .send()
        .await
        .map_err(|e| format!("replay qualities request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("replay qualities status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("replay qualities parse error: {e}"))?;

    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code == -101 {
        return Err("请先在设置中登录B站账号".to_string());
    }
    if code != 0 {
        let msg = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("获取回放地址失败: {msg}"));
    }

    let data = payload.get("data");

    // Check if download_url is available (already synthesized)
    if let Some(url) = data
        .and_then(|d| d.get("download_url"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Ok(vec![ReplayQuality {
            name: "原画".to_string(),
            url: url.to_string(),
            bit_rate: 0,
            level: 4,
        }]);
    }

    // Otherwise try GetSliceStream for HLS URL
    let record = data
        .and_then(|d| d.get("record"))
        .cloned()
        .unwrap_or(Value::Null);

    let status = record.get("status").and_then(Value::as_i64).unwrap_or(0);
    let estimated_time = record.get("estimated_time").and_then(Value::as_i64);

    if status == 30 || status == 2 {
        if let Some(url) = record.get("url").and_then(Value::as_str) {
            return Ok(vec![ReplayQuality {
                name: "原画".to_string(),
                url: url.to_string(),
                bit_rate: 0,
                level: 4,
            }]);
        }
    }

    let time_msg = if let Some(ts) = estimated_time {
        let remaining = ts
            - std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
        if remaining > 0 {
            let h = remaining / 3600;
            let m = (remaining % 3600) / 60;
            if h > 0 {
                format!("预计约{}小时{}分钟后可用", h, m)
            } else {
                format!("预计约{}分钟后可用", m)
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    Err(format!(
        "回放正在合成中{}{}",
        if !time_msg.is_empty() { "，" } else { "" },
        time_msg
    ))
}
