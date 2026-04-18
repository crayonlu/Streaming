use deno_core::{FastString, JsRuntime, RuntimeOptions};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use super::super::http::shared_client;
use super::{value_to_string, CRYPTO_JS, DEFAULT_DOUYU_DID, DEFAULT_UA};

// ── Constants ────────────────────────────────────────────────────────────────

const REPLAY_LIST_ENDPOINT: &str = "https://v.douyu.com/wgapi/vod/center/authorShowVideoList";
const REPLAY_STREAM_ENDPOINT: &str = "https://v.douyu.com/wgapi/vodnc/front/stream/getStreamUrlWeb";
const VOD_REFERER: &str = "https://v.douyu.com/";

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Parse a duration display string ("MM:SS" or "HH:MM:SS") into total seconds.
fn parse_duration_str(s: &str) -> Option<u64> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    match parts.len() {
        2 => {
            let m: u64 = parts[0].parse().ok()?;
            let s: u64 = parts[1].parse().ok()?;
            Some(m * 60 + s)
        }
        3 => {
            let h: u64 = parts[0].parse().ok()?;
            let m: u64 = parts[1].parse().ok()?;
            let s: u64 = parts[2].parse().ok()?;
            Some(h * 3600 + m * 60 + s)
        }
        _ => None,
    }
}

/// Resolve a short room ID to the VOD platform `up_id` via the betard API.
async fn resolve_up_id(client: &reqwest::Client, room_id: &str) -> Result<String, String> {
    let betard: Value = client
        .get(format!("https://www.douyu.com/betard/{room_id}"))
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", format!("https://www.douyu.com/{room_id}"))
        .send()
        .await
        .map_err(|e| format!("betard request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("betard parse failed: {e}"))?;

    betard
        .get("room")
        .and_then(|r| r.get("up_id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| "up_id not found in betard".to_string())
}

/// Build a `ReplayItem` from a `getShowReplayList` part entry.
fn build_replay_item_from_part(
    part: &Value,
    room_id: &str,
    up_id: &str,
    total_parts: u32,
    recorded_at: i64,
) -> Option<crate::models::ReplayItem> {
    let hash_id = value_to_string(part.get("hash_id"));
    if hash_id.is_empty() {
        return None;
    }
    let title = value_to_string(part.get("title"));
    let cover_url = {
        let raw = value_to_string(part.get("cover"));
        if raw.is_empty() {
            None
        } else {
            Some(raw)
        }
    };
    let duration_str_raw = value_to_string(part.get("video_duration"));
    let duration_secs = if duration_str_raw.is_empty() {
        None
    } else {
        parse_duration_str(&duration_str_raw)
    };
    let show_remark = {
        let s = value_to_string(part.get("show_remark"));
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    };
    let part_num = part.get("rank").and_then(Value::as_u64).unwrap_or(1) as u32;
    let show_id = part.get("show_id").and_then(Value::as_i64).unwrap_or(0);
    let view_count_text = {
        let v = part.get("view_num").and_then(Value::as_u64).unwrap_or(0);
        if v == 0 {
            None
        } else {
            Some(v.to_string())
        }
    };

    Some(crate::models::ReplayItem {
        id: hash_id,
        platform: crate::models::PlatformId::Douyu,
        room_id: room_id.to_string(),
        title,
        cover_url,
        duration_str: if duration_str_raw.is_empty() {
            None
        } else {
            Some(duration_str_raw)
        },
        duration_secs,
        recorded_at,
        view_count_text,
        part_num,
        total_parts,
        show_id,
        show_remark,
        up_id: up_id.to_string(),
    })
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Returns one `ReplayItem` per live session (the **first part** only).
/// `total_parts` is set to `re_num` so the frontend knows how many parts exist.
pub async fn get_replay_list(
    room_id: &str,
    page: u32,
) -> Result<Vec<crate::models::ReplayItem>, String> {
    let client = shared_client();
    let up_id = resolve_up_id(client, room_id).await?;

    let resp: Value = client
        .get(REPLAY_LIST_ENDPOINT)
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", VOD_REFERER)
        .query(&[
            ("up_id", up_id.as_str()),
            ("page", &page.to_string()),
            ("limit", "12"),
        ])
        .send()
        .await
        .map_err(|e| format!("replay list request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("replay list parse failed: {e}"))?;

    if resp.get("error").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = resp.get("msg").and_then(Value::as_str).unwrap_or("unknown");
        return Err(format!("replay list api error: {msg}"));
    }

    let shows = resp
        .get("data")
        .and_then(|d| d.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut items: Vec<crate::models::ReplayItem> = Vec::new();
    for show in &shows {
        // The first (and usually only) entry in video_list is the representative part.
        let Some(first_video) = show
            .get("video_list")
            .and_then(Value::as_array)
            .and_then(|v| v.first())
        else {
            continue;
        };

        let hash_id = value_to_string(first_video.get("hash_id"));
        if hash_id.is_empty() {
            continue;
        }

        let total_parts = show
            .get("re_num")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as u32;

        let recorded_at = first_video
            .get("start_time")
            .and_then(Value::as_i64)
            .unwrap_or(0);

        // Use show title (cleaner) falling back to video title
        let title = {
            let show_title = value_to_string(show.get("title"));
            if show_title.is_empty() {
                value_to_string(first_video.get("title"))
            } else {
                show_title
            }
        };

        let cover_url = {
            let raw = value_to_string(first_video.get("video_pic"));
            if raw.is_empty() {
                None
            } else {
                Some(raw)
            }
        };

        // Use total replay_duration for the session
        let (duration_str, duration_secs) = {
            let rd = value_to_string(show.get("replay_duration"));
            let secs = if rd.is_empty() {
                None
            } else {
                parse_duration_str(&rd)
            };
            (if rd.is_empty() { None } else { Some(rd) }, secs)
        };

        let show_remark = {
            let s = value_to_string(
                first_video
                    .get("show_remark")
                    .or_else(|| show.get("time_format")),
            );
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        };

        let show_id = show.get("show_id").and_then(Value::as_i64).unwrap_or(0);

        let view_count_text = {
            let v = value_to_string(first_video.get("view_num"));
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        };

        items.push(crate::models::ReplayItem {
            id: hash_id,
            platform: crate::models::PlatformId::Douyu,
            room_id: room_id.to_string(),
            title,
            cover_url,
            duration_str,
            duration_secs,
            recorded_at,
            view_count_text,
            part_num: 1,
            total_parts,
            show_id,
            show_remark,
            up_id: up_id.clone(),
        });
    }

    Ok(items)
}

const REPLAY_PARTS_ENDPOINT: &str = "https://v.douyu.com/wgapi/vod/center/getShowReplayList";

/// Returns ALL parts (P1 / P2 / P3 …) for a specific live session.
///
/// `hash_id` is the id of **any** part from the session (typically P1);
/// `up_id` is the VOD platform author ID (available in every `ReplayItem`).
pub async fn get_replay_parts(
    room_id: &str,
    hash_id: &str,
    up_id: &str,
) -> Result<Vec<crate::models::ReplayItem>, String> {
    let client = shared_client();

    let resp: Value = client
        .get(REPLAY_PARTS_ENDPOINT)
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", VOD_REFERER)
        .query(&[("vid", hash_id), ("up_id", up_id)])
        .send()
        .await
        .map_err(|e| format!("replay parts request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("replay parts parse failed: {e}"))?;

    if resp.get("error").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = resp.get("msg").and_then(Value::as_str).unwrap_or("unknown");
        return Err(format!("replay parts api error: {msg}"));
    }

    let list = resp
        .get("data")
        .and_then(|d| d.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let total_parts = list.len() as u32;

    // Use the start_time of the first part as the session's recorded_at.
    // getShowReplayList doesn't include start_time; we'll use 0 as a placeholder.
    let recorded_at = 0i64;

    let items = list
        .iter()
        .filter_map(|part| {
            build_replay_item_from_part(part, room_id, up_id, total_parts, recorded_at)
        })
        .collect();

    Ok(items)
}

/// Returns all available quality options for a replay segment.
/// The caller should present these to the user; the highest `level` is
/// the best quality (typically 超清 level=4).
pub async fn get_replay_qualities(
    hash_id: &str,
) -> Result<Vec<crate::models::ReplayQuality>, String> {
    let client = shared_client();

    // 1. Fetch the VOD show page and extract signing params
    let page_html = client
        .get(format!("https://v.douyu.com/show/{hash_id}"))
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", VOD_REFERER)
        .send()
        .await
        .map_err(|e| format!("vod show page request failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("vod show page read failed: {e}"))?;

    // Extract point_id and vid from window.$DATA (or anywhere in the page)
    let point_id = {
        let re = regex::Regex::new(r#""point_id"\s*:\s*(\d+)"#)
            .map_err(|e| format!("regex error: {e}"))?;
        re.captures(&page_html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| "point_id not found in show page".to_string())?
    };

    let vid = {
        // In $DATA the vid comes right at the start of ROOM object
        let re = regex::Regex::new(r#"ROOM\s*:\s*\{\s*"vid"\s*:\s*"([^"]+)""#)
            .map_err(|e| format!("regex error: {e}"))?;
        re.captures(&page_html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| hash_id.to_string())
    };

    // 2. Extract inline scripts and find the one containing ub98484234
    let script_re = regex::Regex::new(r"(?s)<script\b[^>]*>([\s\S]*?)</script>")
        .map_err(|e| format!("regex error: {e}"))?;
    let sign_script = script_re
        .captures_iter(&page_html)
        .map(|c| c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default())
        .find(|s| s.contains("ub98484234"))
        .ok_or_else(|| "signing script not found in show page".to_string())?;

    // 3. Execute ub98484234(point_id, did, timestamp) via deno_core V8 engine.
    let post_body: String = {
        let did = DEFAULT_DOUYU_DID;
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("system time error: {e}"))?
            .as_secs() as i64;

        let mut runtime = JsRuntime::new(RuntimeOptions::default());
        runtime
            .execute_script("[douyu-vod]", FastString::from(CRYPTO_JS.to_string()))
            .map_err(|e| format!("inject cryptojs failed: {e}"))?;
        runtime
            .execute_script("[douyu-vod]", FastString::from(sign_script))
            .map_err(|e| format!("inject sign script failed: {e}"))?;

        let call_expr = format!("ub98484234({point_id:?},{did:?},{ts})");
        let js_result = runtime
            .execute_script("[douyu-vod]", FastString::from(call_expr))
            .map_err(|e| format!("execute sign function failed: {e}"))?;

        let scope = &mut runtime.handle_scope();
        let result = js_result.open(scope);
        let params = result.to_rust_string_lossy(scope);

        format!("{params}&vid={vid}")
    };

    // 4. POST to getStreamUrlWeb
    let stream_resp: Value = client
        .post(REPLAY_STREAM_ENDPOINT)
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", format!("https://v.douyu.com/show/{hash_id}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(post_body)
        .send()
        .await
        .map_err(|e| format!("stream url request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("stream url parse failed: {e}"))?;

    if stream_resp
        .get("error")
        .and_then(Value::as_i64)
        .unwrap_or(-1)
        != 0
    {
        let msg = stream_resp
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("stream url api error: {msg}"));
    }

    let thumb_video = stream_resp
        .get("data")
        .and_then(|d| d.get("thumb_video"))
        .and_then(Value::as_object)
        .ok_or_else(|| "thumb_video not found in response".to_string())?;

    // Collect all qualities, sorted best→worst
    const QUALITY_ORDER: &[&str] = &["超清", "高清", "标清", "流畅"];

    let mut qualities: Vec<crate::models::ReplayQuality> = Vec::new();

    for &qname in QUALITY_ORDER {
        if let Some(v) = thumb_video.get(qname) {
            let url = v
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if url.is_empty() {
                continue;
            }
            let bit_rate = v.get("bit_rate").and_then(Value::as_u64).unwrap_or(0) as u32;
            let level = v.get("level").and_then(Value::as_u64).unwrap_or(0) as u32;
            qualities.push(crate::models::ReplayQuality {
                name: qname.to_string(),
                url,
                bit_rate,
                level,
            });
        }
    }

    // Fallback: include any remaining keys not in the ordered list
    for (key, v) in thumb_video {
        if QUALITY_ORDER.contains(&key.as_str()) {
            continue;
        }
        let url = v
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if url.is_empty() {
            continue;
        }
        let bit_rate = v.get("bit_rate").and_then(Value::as_u64).unwrap_or(0) as u32;
        let level = v.get("level").and_then(Value::as_u64).unwrap_or(0) as u32;
        qualities.push(crate::models::ReplayQuality {
            name: key.clone(),
            url,
            bit_rate,
            level,
        });
    }

    if qualities.is_empty() {
        return Err("no playable stream URL found".to_string());
    }

    Ok(qualities)
}
