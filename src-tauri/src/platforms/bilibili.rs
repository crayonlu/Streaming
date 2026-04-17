use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::models::{PlatformId, RoomCard, RoomDetail, StreamFormat, StreamSource};
use super::http::{shared_client, retry};

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const LIVE_REFERER: &str = "https://live.bilibili.com/";
const FEATURED_ENDPOINT: &str = "https://api.live.bilibili.com/xlive/web-interface/v1/index/getList";
const SEARCH_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/search/type";
const FINGERPRINT_ENDPOINT: &str = "https://api.bilibili.com/x/frontend/finger/spi";
const ROOM_PAGE_ENDPOINT: &str = "https://live.bilibili.com";
const PLAYINFO_ENDPOINT: &str = "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo";
const ROOM_INIT_ENDPOINT: &str = "https://api.live.bilibili.com/room/v1/Room/room_init";

fn text_u64(v: Option<u64>) -> Option<String> {
    let number = v?;
    if number >= 10_000 {
        Some(format!("{:.1}万", number as f64 / 10_000.0))
    } else {
        Some(number.to_string())
    }
}

fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

fn value_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn normalize_url(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let url = if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_string()
    };
    // Bilibili's hdslb.com CDN blocks requests without the correct Referer.
    // Route these images through our local HTTP image proxy (proxy.rs) which
    // injects Referer: https://live.bilibili.com/ before forwarding upstream.
    if url.contains("hdslb.com") {
        return crate::proxy::proxify(&url);
    }
    url
}

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

async fn resolve_room_id_and_live(
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
) -> Result<Value, String> {
    let mut query: Vec<(&str, &str)> = vec![("room_id", room_id)];
    query.extend_from_slice(params);

    client
        .get(PLAYINFO_ENDPOINT)
        .header(USER_AGENT, DEFAULT_UA)
        .header(REFERER, LIVE_REFERER)
        .header(reqwest::header::ORIGIN, "https://live.bilibili.com")
        .query(&query)
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
    if source.stream_url.contains("d1--cn") {
        score += 20;
    }
    score
}

async fn probe_source_url(client: &reqwest::Client, url: &str) -> bool {
    match client.get(url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
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
                let qn = codec_item.get("current_qn").and_then(Value::as_i64).unwrap_or(0);
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

                    let is_hls =
                        protocol_name.contains("hls") || format_name == "ts" || stream_url.contains(".m3u8");

                    sources.push(StreamSource {
                        id: format!("bili-{qn}-{}", sources.len()),
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

async fn ensure_buvid(client: &reqwest::Client, cookie_header: &mut String) -> Result<(), String> {
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

async fn get_featured_once() -> Result<Vec<RoomCard>, String> {
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
            ("page", "1"),
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

pub async fn get_featured() -> Result<Vec<RoomCard>, String> {
    retry(2, get_featured_once).await
}

async fn search_rooms_once(keyword: &str) -> Result<Vec<RoomCard>, String> {
    let trimmed = keyword.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let client = shared_client();

    let mut cookie_header = String::new();
    let _ = ensure_buvid(client, &mut cookie_header).await;

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
            ("highlight", "0"),
            ("single_column", "0"),
            ("page", "1"),
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

    let room_items = result
        .get("live_room")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let user_items = result
        .get("live_user")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let source = if room_items.is_empty() { user_items } else { room_items };

    let mut cards = Vec::with_capacity(source.len());
    for item in source {
        let room_id = value_to_string(item.get("roomid").or_else(|| item.get("room_id")));
        if room_id.is_empty() {
            continue;
        }

        let title = value_to_string(item.get("title"));
        let streamer_name = value_to_string(item.get("uname").or_else(|| item.get("nick_name")));
        let cover_main = value_to_string(item.get("cover"));
        let cover_fallback = value_to_string(item.get("cover_from_user"));
        let cover_url = normalize_url(if cover_main.is_empty() {
            &cover_fallback
        } else {
            &cover_main
        });
        let viewers = value_to_u64(item.get("online"))
            .or_else(|| value_to_u64(item.get("online_num")))
            .and_then(|v| text_u64(Some(v)));
        let area_name = item
            .get("cate_name")
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let is_live = item
            .get("live_status")
            .and_then(Value::as_i64)
            .unwrap_or(1)
            == 1;

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

    Ok(cards)
}

pub async fn search_rooms(keyword: &str) -> Result<Vec<RoomCard>, String> {
    let kw = keyword.to_owned();
    retry(2, || search_rooms_once(&kw)).await
}

pub async fn get_room_detail(room_id: &str) -> Result<RoomDetail, String> {
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
    let streamer_name = value_to_string(anchor_info.get("uname").or_else(|| room_init.get("uname")));
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
    let live_status = room_init.get("live_status").and_then(Value::as_i64).unwrap_or(0) == 1;

    Ok(RoomDetail {
        id: format!("bilibili-{normalized_room_id}"),
        platform: PlatformId::Bilibili,
        room_id: normalized_room_id,
        title,
        streamer_name,
        avatar_url: if avatar_url.is_empty() { None } else { Some(avatar_url) },
        cover_url: if cover_url.is_empty() { None } else { Some(cover_url) },
        area_name,
        description,
        is_live: live_status || live_status_from_init,
        followed: false,
    })
}

pub async fn get_stream_sources(room_id: &str) -> Result<Vec<StreamSource>, String> {
    let client = shared_client();

    let (normalized_room_id, is_live) = resolve_room_id_and_live(client, room_id)
        .await
        .unwrap_or((room_id.to_string(), true));
    if !is_live {
        return Err("主播未开播".to_string());
    }

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
        if let Ok(response) = request_playinfo(client, &normalized_room_id, params).await {
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

    sources.sort_by_key(|s| std::cmp::Reverse(source_priority(s)));

    // Probe top candidates (using the raw CDN URL) to improve first-play success.
    let mut first_reachable_index: Option<usize> = None;
    for (idx, source) in sources.iter().take(6).enumerate() {
        if probe_source_url(client, &source.stream_url).await {
            first_reachable_index = Some(idx);
            break;
        }
    }
    if let Some(idx) = first_reachable_index {
        if let Some(item) = sources.get_mut(idx) {
            item.is_default = Some(true);
        }
    }

    // Route all HLS streams through the local proxy so that WebView2 does not
    // send requests directly to the Bilibili CDN.  The CDN TCP-resets any
    // connection whose Origin header is not "https://live.bilibili.com"
    // (WebView2 sends "tauri://localhost"), causing ERR_CONNECTION_RESET.
    // The proxy injects the correct Referer/Origin and forwards the M3U8 and
    // every TS/fMP4 segment on behalf of the browser.
    for source in &mut sources {
        if matches!(source.format, crate::models::StreamFormat::Hls) {
            source.stream_url = crate::proxy::proxify_stream(&source.stream_url);
        }
    }

    Ok(sources)
}
