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

    let mut cards = Vec::new();
    let users = payload
        .get("data")
        .and_then(|d| d.get("relateUser"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for user in users {
        let anchor = user.get("anchorInfo").unwrap_or(&Value::Null);
        let room_id = value_to_string(anchor.get("rid"));
        if room_id.is_empty() {
            continue;
        }

        let title = value_to_string(anchor.get("rn").or_else(|| anchor.get("description")));
        let streamer_name = value_to_string(anchor.get("nn").or_else(|| anchor.get("nickName")));
        let cover_url = normalize_url(
            &value_to_string(anchor.get("roomSrc").or_else(|| anchor.get("avatar"))),
        );
        let area_name = anchor
            .get("cateName")
            .or_else(|| anchor.get("c2name"))
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let viewers = text_u64(
            value_to_u64(anchor.get("ol"))
                .or_else(|| value_to_u64(anchor.get("followerCount"))),
        );
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
