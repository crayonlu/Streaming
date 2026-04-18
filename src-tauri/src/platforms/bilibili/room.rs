use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::super::http::shared_client;
use super::cookie;
use super::replay::read_saved_cookie;
use super::{normalize_url, value_to_string, DEFAULT_UA, LIVE_REFERER, ROOM_INIT_ENDPOINT};
use crate::models::{PlatformId, RoomDetail, StreamFormat, StreamSource};

// ── Constants ────────────────────────────────────────────────────────────────

const ROOM_PAGE_ENDPOINT: &str = "https://live.bilibili.com";
const PLAYINFO_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo";
const FINGERPRINT_ENDPOINT: &str = "https://api.bilibili.com/x/frontend/finger/spi";

// ── Internal helpers ─────────────────────────────────────────────────────────

fn parse_neptune_payload(html: &str) -> Result<Value, String> {
    let marker = "window.__NEPTUNE_IS_MY_WAIFU__=";
    let start = html
        .find(marker)
        .ok_or_else(|| "neptune payload marker missing".to_string())?
        + marker.len();

    let tail = &html[start..];
    let script_end = tail
        .find("</script>")
        .ok_or_else(|| "neptune payload script end missing".to_string())?;
    let mut json_str = tail[..script_end].trim();
    if let Some(stripped) = json_str.strip_suffix(';') {
        json_str = stripped.trim();
    }

    serde_json::from_str(json_str).map_err(|e| format!("neptune payload parse error: {e}"))
}

async fn fetch_room_payload(client: &reqwest::Client, room_id: &str) -> Result<Value, String> {
    let html = client
        .get(format!("{ROOM_PAGE_ENDPOINT}/{room_id}"))
        .header(USER_AGENT, DEFAULT_UA)
        .send()
        .await
        .map_err(|e| format!("room page request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("room page status error: {e}"))?
        .text()
        .await
        .map_err(|e| format!("room page read error: {e}"))?;
    parse_neptune_payload(&html)
}

async fn fetch_room_init(client: &reqwest::Client, room_id: &str) -> Result<Value, String> {
    client
        .get(ROOM_INIT_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .query(&[("id", room_id)])
        .send()
        .await
        .map_err(|e| format!("room_init request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("room_init status error: {e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("room_init parse error: {e}"))
}

pub(crate) async fn resolve_room_id_and_live(
    client: &reqwest::Client,
    room_id: &str,
) -> Result<(String, bool), String> {
    let payload = fetch_room_init(client, room_id).await?;
    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    let normalized_room_id = value_to_string(data.get("room_id"));
    let live_status = data.get("live_status").and_then(Value::as_i64).unwrap_or(0) == 1;

    Ok((
        if normalized_room_id.is_empty() {
            room_id.to_string()
        } else {
            normalized_room_id
        },
        live_status,
    ))
}

async fn request_playinfo(
    client: &reqwest::Client,
    room_id: &str,
    params: &[(&str, &str)],
    cookie: Option<&str>,
) -> Result<Value, String> {
    let mut query: Vec<(&str, &str)> = vec![("room_id", room_id)];
    query.extend_from_slice(params);

    let mut request = client
        .get(PLAYINFO_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .header(reqwest::header::ORIGIN, "https://live.bilibili.com")
        .query(&query);
    if let Some(c) = cookie {
        request = request.header(COOKIE, c);
    }
    request
        .send()
        .await
        .map_err(|e| format!("bilibili playinfo request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bilibili playinfo status error: {e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("bilibili playinfo parse error: {e}"))
}

fn extract_playurl(payload: &Value) -> Value {
    payload
        .get("data")
        .and_then(|v| v.get("playurl_info"))
        .and_then(|v| v.get("playurl"))
        .cloned()
        .unwrap_or(Value::Null)
}

fn source_priority(source: &StreamSource) -> i32 {
    let mut score = 0;
    if source.is_default.unwrap_or(false) {
        score += 100;
    }
    if matches!(source.format, StreamFormat::Hls) {
        score += 50;
    }
    if let Some(cdn) = &source.cdn {
        match cdn.as_str() {
            "主线路" => score += 20,
            "备用1" => score += 15,
            "备用2" => score += 10,
            "备用3" => score += 5,
            _ => {}
        }
    }
    score
}

async fn probe_source_url(client: &reqwest::Client, url: &str) -> Option<u64> {
    let start = std::time::Instant::now();
    match client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => Some(start.elapsed().as_millis() as u64),
        _ => None,
    }
}

fn parse_playurl_to_sources(playurl: &Value, room_id: &str) -> Vec<StreamSource> {
    let mut qn_map: HashMap<i64, String> = HashMap::new();
    if let Some(arr) = playurl.get("g_qn_desc").and_then(Value::as_array) {
        for item in arr {
            if let Some(qn) = item.get("qn").and_then(Value::as_i64) {
                let label = item
                    .get("desc")
                    .and_then(Value::as_str)
                    .unwrap_or("Auto")
                    .to_string();
                qn_map.insert(qn, label);
            }
        }
    }

    let mut seen = HashSet::new();
    let mut sources: Vec<StreamSource> = vec![];
    let streams = playurl
        .get("stream")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for stream_item in streams {
        let protocol_name = stream_item
            .get("protocol_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        let formats = stream_item
            .get("format")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for format_item in formats {
            let format_name = format_item
                .get("format_name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let codecs = format_item
                .get("codec")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            for codec_item in codecs {
                let qn = codec_item
                    .get("current_qn")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let quality_label = qn_map
                    .get(&qn)
                    .cloned()
                    .unwrap_or_else(|| format!("QN {qn}"));
                let base_url = codec_item
                    .get("base_url")
                    .and_then(Value::as_str)
                    .unwrap_or("");

                let url_infos = codec_item
                    .get("url_info")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for url_info in url_infos {
                    let host = url_info.get("host").and_then(Value::as_str).unwrap_or("");
                    let extra = url_info.get("extra").and_then(Value::as_str).unwrap_or("");
                    if host.is_empty() || base_url.is_empty() {
                        continue;
                    }
                    let stream_url = format!("{host}{base_url}{extra}");
                    if stream_url.is_empty() || !seen.insert(stream_url.clone()) {
                        continue;
                    }

                    let is_hls = protocol_name.contains("hls")
                        || format_name == "ts"
                        || format_name == "fmp4"
                        || format_name == "m4s"
                        || stream_url.contains(".m3u8")
                        || stream_url.contains(".m4s");

                    let cdn = extract_cdn_name(host);

                    sources.push(StreamSource {
                        id: format!("bili-{}-{}-{}", qn, cdn, sources.len()),
                        platform: PlatformId::Bilibili,
                        room_id: room_id.to_string(),
                        quality_key: qn.to_string(),
                        quality_label: quality_label.clone(),
                        stream_url,
                        format: if is_hls {
                            StreamFormat::Hls
                        } else {
                            StreamFormat::Flv
                        },
                        is_default: Some(qn == 0 || qn >= 10_000),
                        cdn: Some(cdn),
                    });
                }
            }
        }
    }

    if sources.iter().all(|s| !s.is_default.unwrap_or(false)) {
        if let Some(first) = sources.first_mut() {
            first.is_default = Some(true);
        }
    }
    sources
}

fn extract_cdn_name(host: &str) -> String {
    if host.contains("d1--cn") {
        "主线路".to_string()
    } else if host.contains("d2--cn") {
        "备用1".to_string()
    } else if host.contains("ws--cn") {
        "备用2".to_string()
    } else if host.contains("dx--cn") {
        "备用3".to_string()
    } else {
        let parts: Vec<&str> = host.split('.').collect();
        parts.first().unwrap_or(&host).to_string()
    }
}

// ── Cookie helpers for ensure_buvid ──────────────────────────────────────────

fn cookie_pairs(cookie: &str) -> Vec<(String, String)> {
    cookie
        .split(';')
        .filter_map(|chunk| {
            let trimmed = chunk.trim();
            if trimmed.is_empty() {
                return None;
            }
            let mut parts = trimmed.splitn(2, '=');
            let key = parts.next()?.trim();
            let value = parts.next().unwrap_or("").trim();
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn has_cookie_key(pairs: &[(String, String)], key: &str) -> bool {
    pairs.iter().any(|(k, _)| k.eq_ignore_ascii_case(key))
}

fn upsert_cookie_key(pairs: &mut Vec<(String, String)>, key: &str, value: &str) {
    if let Some((_, v)) = pairs.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(key)) {
        *v = value.to_string();
    } else {
        pairs.push((key.to_string(), value.to_string()));
    }
}

fn encode_cookie(pairs: &[(String, String)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

pub(crate) async fn ensure_buvid(
    client: &reqwest::Client,
    cookie_header: &mut String,
) -> Result<(), String> {
    let mut pairs = cookie_pairs(cookie_header);
    if has_cookie_key(&pairs, "buvid3") && has_cookie_key(&pairs, "buvid4") {
        return Ok(());
    }

    let mut request = client
        .get(FINGERPRINT_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER);

    if !cookie_header.trim().is_empty() {
        request = request.header(COOKIE, cookie_header.as_str());
    }

    let payload: Value = request
        .send()
        .await
        .map_err(|e| format!("bilibili fingerprint request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bilibili fingerprint status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("bilibili fingerprint parse error: {e}"))?;

    let data = payload.get("data").and_then(Value::as_object);
    if let Some(data) = data {
        if let Some(b3) = data.get("b_3").and_then(Value::as_str) {
            if !b3.is_empty() {
                upsert_cookie_key(&mut pairs, "buvid3", b3);
            }
        }
        if let Some(b4) = data.get("b_4").and_then(Value::as_str) {
            if !b4.is_empty() {
                upsert_cookie_key(&mut pairs, "buvid4", b4);
            }
        }
    }

    *cookie_header = encode_cookie(&pairs);
    Ok(())
}

// ── Public API ───────────────────────────────────────────────────────────────

pub async fn get_room_detail(
    _app_handle: &tauri::AppHandle,
    room_id: &str,
) -> Result<RoomDetail, String> {
    let client = shared_client();
    let (normalized_room_id, live_status_from_init) = resolve_room_id_and_live(client, room_id)
        .await
        .unwrap_or((room_id.to_string(), false));

    let payload = match fetch_room_payload(client, &normalized_room_id).await {
        Ok(payload) => payload,
        Err(_) => fetch_room_payload(client, room_id).await?,
    };

    let room_init = payload
        .get("roomInitRes")
        .and_then(|v| v.get("data"))
        .cloned()
        .unwrap_or(Value::Null);
    let room_info = payload
        .get("roomInfoRes")
        .and_then(|v| v.get("data"))
        .cloned()
        .unwrap_or(Value::Null);
    let anchor_info = room_info
        .get("anchor_info")
        .and_then(|v| v.get("base_info"))
        .cloned()
        .unwrap_or(Value::Null);

    let title = value_to_string(
        room_info
            .get("room_info")
            .and_then(|v| v.get("title"))
            .or_else(|| room_init.get("title")),
    );
    let streamer_name =
        value_to_string(anchor_info.get("uname").or_else(|| room_init.get("uname")));
    let avatar_url = normalize_url(&value_to_string(anchor_info.get("face")));
    let cover_url = normalize_url(&value_to_string(
        room_info
            .get("room_info")
            .and_then(|v| v.get("cover"))
            .or_else(|| room_init.get("cover")),
    ));
    let area_name = room_info
        .get("room_info")
        .and_then(|v| v.get("area_name"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let description = room_info
        .get("room_info")
        .and_then(|v| v.get("description"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let live_status = room_init
        .get("live_status")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        == 1;

    Ok(RoomDetail {
        id: format!("bilibili-{normalized_room_id}"),
        platform: PlatformId::Bilibili,
        room_id: normalized_room_id,
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
        is_live: live_status || live_status_from_init,
        followed: false,
    })
}

pub async fn get_stream_sources(
    app_handle: &tauri::AppHandle,
    room_id: &str,
) -> Result<Vec<StreamSource>, String> {
    let client = shared_client();

    let (normalized_room_id, is_live) = resolve_room_id_and_live(client, room_id)
        .await
        .unwrap_or((room_id.to_string(), true));
    if !is_live {
        return Err("主播未开播".to_string());
    }

    // Try to inject saved SESSDATA for higher-quality streams.
    let webview_cookie = cookie::get_bilibili_cookie(app_handle).await.cookie;
    let saved_cookie = read_saved_cookie().await;
    let cookie = webview_cookie.or(saved_cookie);

    let param_sets: Vec<Vec<(&str, &str)>> = vec![
        vec![
            ("protocol", "0,1"),
            ("format", "0,1,2"),
            ("codec", "0"),
            ("platform", "html5"),
            ("dolby", "5"),
        ],
        vec![
            ("protocol", "0,1"),
            ("format", "0,1,2"),
            ("codec", "0,1"),
            ("platform", "web"),
            ("ptype", "8"),
            ("qn", "10000"),
        ],
        vec![
            ("protocol", "0,1"),
            ("format", "0,1,2"),
            ("codec", "0,1"),
            ("platform", "html5"),
            ("qn", "10000"),
        ],
        vec![
            ("protocol", "1"),
            ("format", "0,2"),
            ("codec", "0"),
            ("platform", "web"),
            ("qn", "10000"),
        ],
    ];

    let mut sources = vec![];
    for params in &param_sets {
        if let Ok(response) =
            request_playinfo(client, &normalized_room_id, params, cookie.as_deref()).await
        {
            sources = parse_playurl_to_sources(&extract_playurl(&response), &normalized_room_id);
            if !sources.is_empty() {
                break;
            }
        }
    }

    if sources.is_empty() {
        // Fallback to room page payload, which occasionally carries playurl_info.
        if let Ok(payload) = fetch_room_payload(client, &normalized_room_id).await {
            let fallback_playurl = payload
                .get("roomInitRes")
                .and_then(|v| v.get("data"))
                .and_then(|v| v.get("playurl_info"))
                .and_then(|v| v.get("playurl"))
                .cloned()
                .unwrap_or(Value::Null);
            sources = parse_playurl_to_sources(&fallback_playurl, &normalized_room_id);
        }
    }

    if sources.is_empty() {
        return Err("未获取到可用播放源".to_string());
    }

    #[derive(Debug)]
    struct ProbeResult {
        source: StreamSource,
        latency_ms: Option<u64>,
    }

    let probe_sources: Vec<(String, StreamSource)> = sources
        .into_iter()
        .map(|s| (s.stream_url.clone(), s))
        .collect();

    use tokio::task::JoinSet;
    let mut join_set = JoinSet::new();
    for (url, s) in probe_sources {
        let client = client.clone();
        join_set.spawn(async move {
            let latency = probe_source_url(&client, &url).await;
            ProbeResult {
                source: s,
                latency_ms: latency,
            }
        });
    }

    let mut results: Vec<ProbeResult> = Vec::new();
    while let Some(result) = join_set.join_next().await {
        if let Ok(r) = result {
            if r.latency_ms.is_some() {
                results.push(r);
            }
        }
    }

    if results.is_empty() {
        return Err("所有CDN路线均不可达，请检查网络".to_string());
    }

    let mut reachable: Vec<StreamSource> = results.into_iter().map(|r| r.source).collect();

    // Sort by: 1) quality priority (desc), 2) CDN priority (desc), 3) format (HLS first)
    // Keep ALL CDN lines, just sort them
    reachable.sort_by(|a, b| {
        let priority_a = source_priority(a);
        let priority_b = source_priority(b);
        priority_b.cmp(&priority_a)
    });

    // Group by quality, mark the first one in each quality group as default
    let mut quality_groups: HashMap<String, usize> = HashMap::new();
    for (idx, source) in reachable.iter_mut().enumerate() {
        let entry = quality_groups
            .entry(source.quality_key.clone())
            .or_insert(idx);
        if *entry == idx {
            source.is_default = Some(true);
        }
    }

    // Route all HLS streams through the local proxy so that WebView2 does not
    // send requests directly to the Bilibili CDN.
    for source in &mut reachable {
        if matches!(source.format, crate::models::StreamFormat::Hls) {
            source.stream_url = crate::proxy::proxify_stream(&source.stream_url);
        }
    }

    Ok(reachable)
}
