use deno_core::{FastString, JsRuntime, RuntimeOptions};
use html_escape::decode_html_entities;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    redirect::Policy,
    Client,
};
use serde::Deserialize;
use serde_json::Value;
use std::cell::RefCell;
use std::time::{SystemTime, UNIX_EPOCH};

use super::super::http::{custom_client_builder, shared_client};
use super::{
    normalize_url, value_to_i32, value_to_string, CRYPTO_JS, DEFAULT_DOUYU_CDN, DEFAULT_DOUYU_DID,
    DEFAULT_UA,
};
use crate::models::{PlatformId, RoomDetail, StreamFormat, StreamSource};

// ── Thread-local JS runtime cache ────────────────────────────────────────────
//
// `JsRuntime` is neither `Send` nor `Sync`, so it cannot be shared across
// threads via `Mutex` without wrapping in an `Arc<Mutex<…>>` and forcing
// sequential execution.  Instead we keep one runtime per tokio worker thread
// (`thread_local!`), which gives us:
//
//   - Zero lock contention — each thread owns its instance.
//   - ~50-100 ms cold-start amortised to the first call per thread rather
//     than every call.
//   - The CryptoJS bundle injected once per runtime lifetime, not per call.
//
// `RefCell` provides interior mutability without `unsafe`; it is sound here
// because `thread_local!` storage is never accessed from another thread.
thread_local! {
    static JS_RUNTIME: RefCell<Option<JsRuntime>> = const { RefCell::new(None) };
}

/// Execute the douyu signing function inside the thread-local `JsRuntime`.
///
/// On first call per thread the runtime is initialised and CryptoJS is
/// injected.  Subsequent calls reuse the same isolate, paying only the cost
/// of executing the signing expression (~1 ms).
fn execute_js_sign_tl(script: &str, rid: &str, did: &str, ts: i64) -> Result<String, String> {
    JS_RUNTIME.with(|cell| {
        let mut opt = cell.borrow_mut();

        // ── Initialise once per thread ──────────────────────────────────────
        if opt.is_none() {
            let mut rt = JsRuntime::new(RuntimeOptions::default());
            rt.execute_script("[douyu-init]", FastString::from(CRYPTO_JS.to_string()))
                .map_err(|e| format!("inject cryptojs failed: {e}"))?;
            *opt = Some(rt);
        }

        let runtime = opt.as_mut().expect("just initialised above");

        // ── Inject the per-room signing script ──────────────────────────────
        runtime
            .execute_script("[douyu-sign]", FastString::from(script.to_string()))
            .map_err(|e| format!("inject sign script failed: {e}"))?;

        // ── Call the signing function ────────────────────────────────────────
        let rid_js =
            serde_json::to_string(rid).map_err(|e| format!("serialize rid failed: {e}"))?;
        let did_js =
            serde_json::to_string(did).map_err(|e| format!("serialize did failed: {e}"))?;
        let call_expr = format!("ub98484234({rid_js},{did_js},{ts});");

        let js_result = runtime
            .execute_script("[douyu-call]", FastString::from(call_expr))
            .map_err(|e| format!("execute sign function failed: {e}"))?;

        let params = {
            let scope = &mut runtime.handle_scope();
            let result = js_result.open(scope);
            result.to_rust_string_lossy(scope)
        };

        Ok(params)
    })
}

// ── Internal types for stream source fetching ────────────────────────────────

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
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

// ── DouyuClient: handles signing & stream URL resolution ─────────────────────

struct DouyuClient {
    did: String,
    rid: String,
    client: Client,
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
        // Delegate to the thread-local runtime to avoid the ~50-100 ms
        // cold-start cost of constructing a new V8 isolate on every call.
        execute_js_sign_tl(script, rid, did, ts)
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

        let room = json
            .room
            .ok_or_else(|| "douyu room data missing".to_string())?;
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
            .get(format!(
                "https://www.douyu.com/swf_api/homeH5Enc?rids={room_id}"
            ))
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

    async fn get_play_qualities(
        &self,
        room_id: &str,
        sign_data: &str,
    ) -> Result<DouyuPlayInfo, String> {
        let payload =
            format!("{sign_data}&cdn=&rate=-1&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0");
        let json = self
            .client
            .post(format!(
                "https://www.douyu.com/lapi/live/getH5Play/{room_id}"
            ))
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
                    .filter_map(|item| {
                        item.get("cdn")
                            .and_then(Value::as_str)
                            .map(|s| s.to_string())
                    })
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
            .post(format!(
                "https://www.douyu.com/lapi/live/getH5Play/{room_id}"
            ))
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

// ── Public API ───────────────────────────────────────────────────────────────

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
    let description = room
        .get("show_details")
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let is_live = room.get("show_status").and_then(Value::as_i64).unwrap_or(0) == 1;

    Ok(RoomDetail {
        id: format!("douyu-{rid}"),
        platform: PlatformId::Douyu,
        room_id: rid,
        title,
        streamer_name,
        avatar_url: if avatar_url.is_empty() {
            None
        } else {
            Some(avatar_url)
        },
        cover_url: if cover_url.is_empty() {
            None
        } else {
            Some(cover_url)
        },
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
    for _attempt in 0..2 {
        let sign_data = match douyu.build_sign_params(&normalized_room_id).await {
            Ok(data) => data,
            Err(err) => {
                last_error = err;
                continue;
            }
        };

        let play_info = match douyu
            .get_play_qualities(&normalized_room_id, &sign_data)
            .await
        {
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
                if sources
                    .iter()
                    .any(|s| s.quality_key == variant.rate.to_string())
                {
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
                    cdn: Some("主线路".to_string()),
                });
            }
        }

        if !sources.is_empty() {
            return Ok(sources);
        }
    }

    Err(if last_error.is_empty() {
        "斗鱼签名或取流失败".to_string()
    } else {
        format!("斗鱼签名或取流失败: {last_error}")
    })
}
