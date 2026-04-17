use deno_core::{FastString, JsRuntime, RuntimeOptions};
use html_escape::decode_html_entities;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    redirect::Policy,
    Client,
};
use serde::Deserialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{PlatformId, RoomCard, RoomDetail, StreamFormat, StreamSource};
use super::http::{custom_client_builder, shared_client, retry};

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const FEATURED_ENDPOINT: &str = "https://www.douyu.com/gapi/rkc/directory/mixListV1/0_0/1";
const SEARCH_ENDPOINT: &str = "https://www.douyu.com/japi/search/api/searchUser";
const DEFAULT_DOUYU_DID: &str = "10000000000000000000000000001501";
const DEFAULT_DOUYU_CDN: &str = "ws-h5";
const CRYPTO_JS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../competitors/DTV/src-tauri/src/platforms/douyu/cryptojs.min.js"
));

#[derive(Deserialize, Debug)]
struct BetardRoomInfo {
    room_id: Option<Value>,
    show_status: Option<Value>,
    #[serde(default)]
    up_id: Option<String>,
}

#[derive(Deserialize, Debug)]
struct BetardResponse {
    room: Option<BetardRoomInfo>,
}

#[derive(Clone, Debug)]
struct DouyuPlayInfo {
    variants: Vec<DouyuRateVariant>,
    cdns: Vec<String>,
}

#[derive(Clone, Debug)]
struct DouyuRateVariant {
    name: String,
    rate: i32,
}

struct DouyuClient {
    did: String,
    rid: String,
    client: Client,
}

fn value_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

fn value_to_i32(value: &Value) -> Option<i32> {
    match value {
        Value::Number(num) => num.as_i64().map(|n| n as i32),
        Value::String(s) => s.parse::<i32>().ok(),
        _ => None,
    }
}

fn text_u64(v: Option<u64>) -> Option<String> {
    let number = v?;
    if number >= 10_000 {
        Some(format!("{:.1}万", number as f64 / 10_000.0))
    } else {
        Some(number.to_string())
    }
}

fn normalize_url(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with("//") {
        format!("https:{}", raw)
    } else {
        raw.to_string()
    }
}

impl DouyuClient {
    async fn new(rid: &str) -> Result<Self, String> {
        let mut default_headers = HeaderMap::new();
        default_headers.insert("User-Agent", HeaderValue::from_static(DEFAULT_UA));
        default_headers.insert(
            "Accept-Language",
            HeaderValue::from_static("zh-CN,zh;q=0.9"),
        );

        let client = custom_client_builder()
            .redirect(Policy::limited(10))
            .default_headers(default_headers)
            .build()
            .map_err(|e| format!("build douyu client failed: {e}"))?;

        Ok(Self {
            did: DEFAULT_DOUYU_DID.to_string(),
            rid: rid.to_string(),
            client,
        })
    }

    async fn execute_js_sign(
        &self,
        script: &str,
        rid: &str,
        did: &str,
        ts: i64,
    ) -> Result<String, String> {
        let mut runtime = JsRuntime::new(RuntimeOptions::default());
        runtime
            .execute_script("[douyu]", FastString::from(CRYPTO_JS.to_string()))
            .map_err(|e| format!("inject cryptojs failed: {e}"))?;
        runtime
            .execute_script("[douyu]", FastString::from(script.to_string()))
            .map_err(|e| format!("inject sign script failed: {e}"))?;

        let rid_js = serde_json::to_string(rid).map_err(|e| format!("serialize rid failed: {e}"))?;
        let did_js = serde_json::to_string(did).map_err(|e| format!("serialize did failed: {e}"))?;
        let call_expr = format!("ub98484234({rid_js},{did_js},{ts});");
        let js_result = runtime
            .execute_script("[douyu]", FastString::from(call_expr))
            .map_err(|e| format!("execute sign function failed: {e}"))?;

        let params = {
            let scope = &mut runtime.handle_scope();
            let result = js_result.open(scope);
            result.to_rust_string_lossy(scope)
        };
        Ok(params)
    }

    async fn fetch_room_detail_basic(&self) -> Result<(String, bool), String> {
        let json = self
            .client
            .get(format!("https://www.douyu.com/betard/{}", self.rid))
            .header("Referer", format!("https://www.douyu.com/{}", self.rid))
            .send()
            .await
            .map_err(|e| format!("douyu betard request failed: {e}"))?
            .json::<BetardResponse>()
            .await
            .map_err(|e| format!("douyu betard parse failed: {e}"))?;

        let room = json.room.ok_or_else(|| "douyu room data missing".to_string())?;
        let room_id_value = room
            .room_id
            .ok_or_else(|| "douyu room_id missing".to_string())?;
        let room_id = match room_id_value {
            Value::String(v) => v,
            Value::Number(v) => v.to_string(),
            _ => return Err("douyu room_id invalid".to_string()),
        };

        let is_live = room
            .show_status
            .as_ref()
            .and_then(value_to_i32)
            .unwrap_or(0)
            == 1;

        Ok((room_id, is_live))
    }

    async fn get_h5_enc(&self, room_id: &str) -> Result<String, String> {
        let json = self
            .client
            .get(format!("https://www.douyu.com/swf_api/homeH5Enc?rids={room_id}"))
            .header("Referer", format!("https://www.douyu.com/{room_id}"))
            .send()
            .await
            .map_err(|e| format!("homeH5Enc request failed: {e}"))?
            .json::<Value>()
            .await
            .map_err(|e| format!("homeH5Enc parse failed: {e}"))?;

        let error_code = json.get("error").and_then(value_to_i32).unwrap_or(-1);
        if error_code != 0 {
            return Err(format!("homeH5Enc error: {error_code}"));
        }

        let key = format!("room{room_id}");
        json.get("data")
            .and_then(|v| v.get(&key))
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .ok_or_else(|| "homeH5Enc data missing".to_string())
    }

    async fn build_sign_params(&self, room_id: &str) -> Result<String, String> {
        let crptext = self.get_h5_enc(room_id).await?;
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("time error: {e}"))?
            .as_secs() as i64;

        self.execute_js_sign(&crptext, room_id, &self.did, ts).await
    }

    async fn get_play_qualities(&self, room_id: &str, sign_data: &str) -> Result<DouyuPlayInfo, String> {
        let payload = format!(
            "{sign_data}&cdn=&rate=-1&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0"
        );
        let json = self
            .client
            .post(format!("https://www.douyu.com/lapi/live/getH5Play/{room_id}"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(payload)
            .send()
            .await
            .map_err(|e| format!("getH5Play quality request failed: {e}"))?
            .json::<Value>()
            .await
            .map_err(|e| format!("getH5Play quality parse failed: {e}"))?;

        let error_code = json.get("error").and_then(value_to_i32).unwrap_or(-1);
        if error_code != 0 {
            let msg = json.get("msg").and_then(Value::as_str).unwrap_or("unknown");
            return Err(format!("getH5Play quality error {error_code}: {msg}"));
        }

        let data = json.get("data").cloned().unwrap_or(Value::Null);
        let mut cdns = data
            .get("cdnsWithName")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("cdn").and_then(Value::as_str).map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        if cdns.is_empty() {
            cdns.push(DEFAULT_DOUYU_CDN.to_string());
        }

        let variants = data
            .get("multirates")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let name = item.get("name").and_then(Value::as_str)?.to_string();
                        let rate = item.get("rate").and_then(value_to_i32)?;
                        Some(DouyuRateVariant { name, rate })
                    })
                    .collect::<Vec<DouyuRateVariant>>()
            })
            .unwrap_or_default();

        Ok(DouyuPlayInfo { variants, cdns })
    }

    async fn get_play_url(
        &self,
        room_id: &str,
        sign_data: &str,
        rate: i32,
        cdn: &str,
    ) -> Result<String, String> {
        let payload = format!("{sign_data}&cdn={cdn}&rate={rate}");
        let json = self
            .client
            .post(format!("https://www.douyu.com/lapi/live/getH5Play/{room_id}"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Referer", format!("https://www.douyu.com/{room_id}"))
            .body(payload)
            .send()
            .await
            .map_err(|e| format!("getH5Play stream request failed: {e}"))?
            .json::<Value>()
            .await
            .map_err(|e| format!("getH5Play stream parse failed: {e}"))?;

        let error_code = json.get("error").and_then(value_to_i32).unwrap_or(-1);
        if error_code != 0 {
            let msg = json.get("msg").and_then(Value::as_str).unwrap_or("unknown");
            return Err(format!("getH5Play stream error {error_code}: {msg}"));
        }

        let data = json.get("data").cloned().unwrap_or(Value::Null);
        let rtmp_url = data
            .get("rtmp_url")
            .and_then(Value::as_str)
            .ok_or_else(|| "missing rtmp_url".to_string())?;
        let rtmp_live = data
            .get("rtmp_live")
            .and_then(Value::as_str)
            .ok_or_else(|| "missing rtmp_live".to_string())?;
        let rtmp_live = decode_html_entities(rtmp_live).to_string();
        Ok(format!("{rtmp_url}/{rtmp_live}"))
    }
}

async fn get_featured_once() -> Result<Vec<RoomCard>, String> {
    let client = shared_client();

    let payload: Value = client
        .get(FEATURED_ENDPOINT)
        .header("User-Agent", DEFAULT_UA)
        .query(&[("limit", "40")])
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
        let cover_url = normalize_url(
            &value_to_string(item.get("rs16").or_else(|| item.get("roomSrc"))),
        );
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

pub async fn get_featured() -> Result<Vec<RoomCard>, String> {
    retry(2, get_featured_once).await
}

async fn search_rooms_once(keyword: &str) -> Result<Vec<RoomCard>, String> {
    let trimmed = keyword.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let did = format!("{:x}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("time error: {e}"))?
        .as_nanos());

    let client = shared_client();

    let payload: Value = client
        .get(SEARCH_ENDPOINT)
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", "https://www.douyu.com/search/")
        .header("Cookie", format!("dy_did={did}; acf_did={did}"))
        .query(&[
            ("kw", trimmed),
            ("page", "1"),
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
        let streamer_name =
            value_to_string(anchor.get("nn").or_else(|| anchor.get("nickName")));
        let cover_url = normalize_url(
            &value_to_string(anchor.get("roomSrc").or_else(|| anchor.get("avatar"))),
        );
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
            let room_id =
                value_to_string(item.get("rid").or_else(|| item.get("roomId")));
            if room_id.is_empty() {
                continue;
            }
            let title =
                value_to_string(item.get("roomName").or_else(|| item.get("rn")));
            let streamer_name =
                value_to_string(item.get("nickname").or_else(|| item.get("nn")));
            let cover_url = normalize_url(
                &value_to_string(item.get("roomSrc").or_else(|| item.get("avatar"))),
            );
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

pub async fn search_rooms(keyword: &str) -> Result<Vec<RoomCard>, String> {
    let kw = keyword.to_owned();
    retry(2, || search_rooms_once(&kw)).await
}

pub async fn get_room_detail(room_id: &str) -> Result<RoomDetail, String> {
    let client = shared_client();

    let payload: Value = client
        .get(format!("https://www.douyu.com/betard/{room_id}"))
        .header("User-Agent", DEFAULT_UA)
        .header("Referer", format!("https://www.douyu.com/{room_id}"))
        .send()
        .await
        .map_err(|e| format!("douyu room detail request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("douyu room detail status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("douyu room detail parse error: {e}"))?;

    let room = payload.get("room").cloned().unwrap_or(Value::Null);
    let normalized_room_id = value_to_string(room.get("room_id"));
    let rid = if normalized_room_id.is_empty() {
        room_id.to_string()
    } else {
        normalized_room_id
    };
    let title = value_to_string(room.get("room_name"));
    let streamer_name = value_to_string(room.get("owner_name").or_else(|| room.get("nickname")));
    let avatar_url = normalize_url(&value_to_string(
        room.get("owner_avatar")
            .or_else(|| room.get("avatar_mid"))
            .or_else(|| room.get("avatar")),
    ));
    let cover_url = normalize_url(&value_to_string(
        room.get("coverSrc")
            .or_else(|| room.get("room_pic"))
            .or_else(|| room.get("room_src")),
    ));
    let area_name = room
        .get("second_lvl_name")
        .or_else(|| room.get("cate2_name"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let description = room.get("show_details").and_then(Value::as_str).map(|s| s.to_string());
    let is_live = room.get("show_status").and_then(Value::as_i64).unwrap_or(0) == 1;

    Ok(RoomDetail {
        id: format!("douyu-{rid}"),
        platform: PlatformId::Douyu,
        room_id: rid,
        title,
        streamer_name,
        avatar_url: if avatar_url.is_empty() { None } else { Some(avatar_url) },
        cover_url: if cover_url.is_empty() { None } else { Some(cover_url) },
        area_name,
        description,
        is_live,
        followed: false,
    })
}

pub async fn get_stream_sources(room_id: &str) -> Result<Vec<StreamSource>, String> {
    let douyu = DouyuClient::new(room_id).await?;
    let (normalized_room_id, is_live) = douyu.fetch_room_detail_basic().await?;
    if !is_live {
        return Err("主播未开播".to_string());
    }

    let mut last_error = String::new();
    for attempt in 0..2 {
        let sign_data = match douyu.build_sign_params(&normalized_room_id).await {
            Ok(data) => data,
            Err(err) => {
                last_error = err;
                continue;
            }
        };

        let play_info = match douyu.get_play_qualities(&normalized_room_id, &sign_data).await {
            Ok(info) => info,
            Err(err) => {
                last_error = err;
                continue;
            }
        };
        if play_info.variants.is_empty() {
            last_error = "当前房间未返回可用清晰度".to_string();
            continue;
        }

        let mut variants = play_info.variants.clone();
        variants.sort_by_key(|v| std::cmp::Reverse(v.rate));

        let mut cdns = play_info.cdns.clone();
        if !cdns.iter().any(|cdn| cdn == DEFAULT_DOUYU_CDN) {
            cdns.insert(0, DEFAULT_DOUYU_CDN.to_string());
        }

        let mut sources: Vec<StreamSource> = Vec::new();
        for cdn in cdns {
            for variant in &variants {
                if sources.iter().any(|s| s.quality_key == variant.rate.to_string()) {
                    continue;
                }

                let stream_url = match douyu
                    .get_play_url(&normalized_room_id, &sign_data, variant.rate, &cdn)
                    .await
                {
                    Ok(url) => url,
                    Err(err) => {
                        last_error = err;
                        continue;
                    }
                };

                sources.push(StreamSource {
                    id: format!("douyu-{}-{}", variant.rate, sources.len()),
                    platform: PlatformId::Douyu,
                    room_id: normalized_room_id.clone(),
                    quality_key: variant.rate.to_string(),
                    quality_label: variant.name.clone(),
                    stream_url,
                    format: StreamFormat::Flv,
                    is_default: Some(sources.is_empty()),
                });
            }
        }

        if !sources.is_empty() {
            if attempt > 0 {
                eprintln!("[douyu] recovered stream sources on retry attempt {}", attempt + 1);
            }
            return Ok(sources);
        }
    }

    Err(if last_error.is_empty() {
        "斗鱼签名或取流失败".to_string()
    } else {
        format!("斗鱼签名或取流失败: {last_error}")
    })
}

// ── Replay ────────────────────────────────────────────────────────────────────

const REPLAY_LIST_ENDPOINT: &str =
    "https://v.douyu.com/wgapi/vod/center/authorShowVideoList";
const REPLAY_STREAM_ENDPOINT: &str =
    "https://v.douyu.com/wgapi/vodnc/front/stream/getStreamUrlWeb";
const VOD_REFERER: &str = "https://v.douyu.com/";

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
        if raw.is_empty() { None } else { Some(raw) }
    };
    let duration_str_raw = value_to_string(part.get("video_duration"));
    let duration_secs = if duration_str_raw.is_empty() {
        None
    } else {
        parse_duration_str(&duration_str_raw)
    };
    let show_remark = {
        let s = value_to_string(part.get("show_remark"));
        if s.is_empty() { None } else { Some(s) }
    };
    let part_num = part
        .get("rank")
        .and_then(Value::as_u64)
        .unwrap_or(1) as u32;
    let show_id = part
        .get("show_id")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let view_count_text = {
        let v = part.get("view_num").and_then(Value::as_u64).unwrap_or(0);
        if v == 0 { None } else { Some(v.to_string()) }
    };

    Some(crate::models::ReplayItem {
        id: hash_id,
        platform: crate::models::PlatformId::Douyu,
        room_id: room_id.to_string(),
        title,
        cover_url,
        duration_str: if duration_str_raw.is_empty() { None } else { Some(duration_str_raw) },
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
            if raw.is_empty() { None } else { Some(raw) }
        };

        // Use total replay_duration for the session
        let (duration_str, duration_secs) = {
            let rd = value_to_string(show.get("replay_duration"));
            let secs = if rd.is_empty() { None } else { parse_duration_str(&rd) };
            (if rd.is_empty() { None } else { Some(rd) }, secs)
        };

        let show_remark = {
            let s = value_to_string(first_video.get("show_remark")
                .or_else(|| show.get("time_format")));
            if s.is_empty() { None } else { Some(s) }
        };

        let show_id = show
            .get("show_id")
            .and_then(Value::as_i64)
            .unwrap_or(0);

        let view_count_text = {
            let v = value_to_string(first_video.get("view_num"));
            if v.is_empty() { None } else { Some(v) }
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

const REPLAY_PARTS_ENDPOINT: &str =
    "https://v.douyu.com/wgapi/vod/center/getShowReplayList";

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
pub async fn get_replay_qualities(hash_id: &str) -> Result<Vec<crate::models::ReplayQuality>, String> {
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

    // 3. Execute ub98484234(point_id, did, timestamp) via Deno.
    //    JsRuntime is NOT Send, so all Deno work is done in a scoped block that
    //    drops the runtime before the next `.await` point below.
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

        let call_expr = format!("ub98484234({point_id},\"{did}\",{ts});");
        let js_result = runtime
            .execute_script("[douyu-vod]", FastString::from(call_expr))
            .map_err(|e| format!("execute sign function failed: {e}"))?;

        let params = {
            let scope = &mut runtime.handle_scope();
            let result = js_result.open(scope);
            result.to_rust_string_lossy(scope)
        };
        // runtime and js_result are dropped here — safe to .await below
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

    if stream_resp.get("error").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = stream_resp.get("msg").and_then(Value::as_str).unwrap_or("unknown");
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
            let url = v.get("url").and_then(Value::as_str).unwrap_or("").to_string();
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
        let url = v.get("url").and_then(Value::as_str).unwrap_or("").to_string();
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
