use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::models::{PlatformId, ReplayItem, ReplayQuality, RoomCard, RoomDetail, StreamFormat, StreamSource};
use super::http::{shared_client, retry};

pub use cookie::BilibiliCookieResult;

// ── Cookie extraction submodule ──────────────────────────────────────────────────
// Auto-extracts SESSDATA / bili_jct from the app's WebView.
// On Windows this reads from the embedded WebView2 store; on macOS it uses
// the WKWebView cookie store via the same API surface.

pub(crate) mod cookie {
    use ::cookie::Cookie;
    use serde::Serialize;
    use std::collections::BTreeMap;
    use std::time::Duration;

    use tauri::{AppHandle, Manager, WebviewUrl};

    /// Result of a cookie collection attempt.
    #[derive(Debug, Serialize, Default)]
    #[serde(rename_all = "camelCase")]
    pub struct BilibiliCookieResult {
        pub cookie: Option<String>,
        pub has_sessdata: bool,
        pub has_bili_jct: bool,
    }

    /// Reads SESSDATA / bili_jct from all open WebView windows.
    /// Falls back to opening a hidden bootstrap window if nothing was found.
    pub async fn get_bilibili_cookie(app_handle: &AppHandle) -> BilibiliCookieResult {
        let url = "https://www.bilibili.com/";

        // First: check all existing windows (avoids creating a new webview if the user
        // already has a Bilibili tab open inside the app).
        let from_existing = collect_from_labels(app_handle, webview_labels(app_handle), url).await;
        if from_existing.has_sessdata {
            return from_existing;
        }

        // Second: open a hidden bootstrap window so we capture cookies even when no
        // Bilibili tab is currently open.
        let from_bootstrap = bootstrap_and_collect(app_handle, url).await;
        merge_results(&from_existing, &from_bootstrap)
    }

    fn webview_labels(app_handle: &AppHandle) -> Vec<String> {
        app_handle.webview_windows().keys().cloned().collect()
    }

    fn merge_results(
        a: &BilibiliCookieResult,
        b: &BilibiliCookieResult,
    ) -> BilibiliCookieResult {
        let cookie = match (&a.cookie, &b.cookie) {
            (Some(a_str), Some(b_str)) => {
                let mut map = BTreeMap::new();
                for pair in a_str.split(';') {
                    if let Some((k, v)) = pair.trim().split_once('=') {
                        map.insert(k.to_string(), v.to_string());
                    }
                }
                for pair in b_str.split(';') {
                    if let Some((k, v)) = pair.trim().split_once('=') {
                        map.insert(k.to_string(), v.to_string());
                    }
                }
                Some(
                    map.into_iter()
                        .map(|(k, v)| format!("{k}={v}"))
                        .collect::<Vec<_>>()
                        .join("; "),
                )
            }
            (a @ Some(_), None) => a.clone(),
            (None, b @ Some(_)) => b.clone(),
            (None, None) => None,
        };
        BilibiliCookieResult {
            cookie,
            has_sessdata: a.has_sessdata || b.has_sessdata,
            has_bili_jct: a.has_bili_jct || b.has_bili_jct,
        }
    }

    /// Opens a hidden WebView at Bilibili, waits for cookies to be set, then reads
    /// the jar and closes the window.
    async fn bootstrap_and_collect(app_handle: &AppHandle, url: &str) -> BilibiliCookieResult {
        let label = "bilibili-silent-bootstrap";

        // Close any stale window from a previous attempt.
        if let Some(old) = app_handle.get_webview_window(label) {
            let _ = old.close();
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let parsed_url = match url::Url::parse(url) {
            Ok(u) => u,
            Err(_) => return BilibiliCookieResult::default(),
        };

        // Clone so we can pass into async blocks that require 'static.
        let handle = app_handle.clone();
        let label_owned = label.to_string();

        // Build a hidden, non-interactive bootstrap window.
        let builder = tauri::WebviewWindowBuilder::new(
            &handle,
            &label_owned,
            WebviewUrl::External(parsed_url),
        )
        .visible(false)
        .resizable(false)
        .focused(false);

        if builder.build().is_err() {
            return BilibiliCookieResult::default();
        }

        // Give the page 3 seconds to run its cookie-setting scripts.
        tokio::time::sleep(Duration::from_secs(3)).await;

        let result = collect_from_labels(&handle, vec![label_owned.clone()], url).await;

        if let Some(w) = handle.get_webview_window(&label_owned) {
            let _ = w.close();
        }

        result
    }

    async fn collect_from_labels(
        app_handle: &AppHandle,
        labels: Vec<String>,
        url: &str,
    ) -> BilibiliCookieResult {
        let url = url.to_string();
        let labels = labels;
        // Clone: AppHandle is Clone + Send + Sync, needed for spawn_blocking 'static.
        let handle = app_handle.clone();

        tauri::async_runtime::spawn_blocking(move || {
            let mut collected: BTreeMap<String, String> = BTreeMap::new();
            let mut has_sessdata = false;
            let mut has_bili_jct = false;

            let parsed_url = match url::Url::parse(&url) {
                Ok(u) => u,
                Err(_) => return BilibiliCookieResult::default(),
            };

            for label in labels {
                let Some(window) = handle.get_webview_window(&label) else {
                    continue;
                };

                // Try URL-scoped read first (works on all platforms / WebView versions).
                if let Ok(cookies) = window.cookies_for_url(parsed_url.clone()) {
                    let (s, j) = merge_cookies(&mut collected, cookies);
                    has_sessdata |= s;
                    has_bili_jct |= j;
                }

                // Fallback: no-URL read if nothing was found yet.
                if !has_sessdata {
                    if let Ok(cookies) = window.cookies() {
                        let (s, j) = merge_cookies(&mut collected, cookies);
                        has_sessdata |= s;
                        has_bili_jct |= j;
                    }
                }
            }

            let cookie = if collected.is_empty() {
                None
            } else {
                Some(
                    collected
                        .into_iter()
                        .map(|(k, v)| format!("{k}={v}"))
                        .collect::<Vec<_>>()
                        .join("; "),
                )
            };

            BilibiliCookieResult {
                cookie,
                has_sessdata,
                has_bili_jct,
            }
        })
        .await
        .unwrap_or_default()
    }

    fn merge_cookies(
        acc: &mut BTreeMap<String, String>,
        cookies: Vec<Cookie<'static>>,
    ) -> (bool, bool) {
        let mut has_sessdata = false;
        let mut has_bili_jct = false;

        for c in cookies {
            let name = c.name().to_string();
            let domain = c.domain().map(|d| d.to_string());

            // Only keep cookies from bilibili.com or well-known bare-name session cookies.
            let is_bilibili = domain
                .as_ref()
                .map(|d| d.contains("bilibili.com"))
                .unwrap_or_else(|| {
                    name.eq_ignore_ascii_case("SESSDATA")
                        || name.eq_ignore_ascii_case("bili_jct")
                        || name.eq_ignore_ascii_case("DedeUserID")
                        || name.eq_ignore_ascii_case("b_lsid")
                });

            if !is_bilibili {
                continue;
            }

            let value = c.value().to_string();
            if name.eq_ignore_ascii_case("SESSDATA") && !value.is_empty() {
                has_sessdata = true;
            }
            if name.eq_ignore_ascii_case("bili_jct") && !value.is_empty() {
                has_bili_jct = true;
            }

            acc.entry(name).or_insert(value);
        }

        (has_sessdata, has_bili_jct)
    }

    /// Opens a visible login window for Bilibili at passport.bilibili.com.
    /// The frontend polls get_bilibili_cookie until login is detected, then closes the window.
    pub async fn open_bilibili_login_window(
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        let label = "bilibili-login-window";

        // Close any existing login window first.
        if let Some(old) = app_handle.get_webview_window(label) {
            let _ = old.close();
            tokio::time::sleep(Duration::from_millis(300)).await;
        }

        let login_url = "https://passport.bilibili.com/login";

        let parsed_url =
            url::Url::parse(login_url).map_err(|e| format!("invalid login URL: {e}"))?;

        let handle = app_handle.clone();
        let label_owned = label.to_string();

        tauri::WebviewWindowBuilder::new(&handle, &label_owned, WebviewUrl::External(parsed_url))
            .title("B站登录")
            .inner_size(420.0, 640.0)
            .resizable(true)
            .focused(true)
            .build()
            .map_err(|e| format!("failed to open login window: {e}"))?;

        Ok(label_owned)
    }

    /// Closes the visible login window if it exists.
    pub async fn close_bilibili_login_window(app_handle: &AppHandle) {
        let label = "bilibili-login-window";
        if let Some(w) = app_handle.get_webview_window(label) {
            let _ = w.close();
        }
    }
}

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const LIVE_REFERER: &str = "https://live.bilibili.com/";
const FEATURED_ENDPOINT: &str = "https://api.live.bilibili.com/xlive/web-interface/v1/index/getList";
const SEARCH_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/search/type";
const LIVE_SEARCH_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/web-interface/v1/search/liveUsers";
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

/// Strip Bilibili's `<em>…</em>` highlight tags that appear in search result titles.
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
fn parse_bili_search_items(items: &[Value]) -> Vec<RoomCard> {
    let mut cards = Vec::with_capacity(items.len());
    for item in items {
        let room_id = value_to_string(item.get("roomid").or_else(|| item.get("room_id")));
        if room_id.is_empty() {
            continue;
        }
        let raw_title = value_to_string(item.get("title"));
        let title = strip_em_tags(&raw_title);
        let streamer_name = strip_em_tags(&value_to_string(
            item.get("uname").or_else(|| item.get("nick_name")),
        ));
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
            .or_else(|| item.get("area_v2_name"))
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
    cards
}

async fn search_rooms_once(keyword: &str) -> Result<Vec<RoomCard>, String> {
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
                ("pn", "1"),
                ("ps", "30"),
            ]);
        if !cookie_header.is_empty() {
            req = req.header(COOKIE, &cookie_header);
        }
        req.send().await.ok().and_then(|r| {
            if r.status().is_success() { Some(r) } else { None }
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
                    return Ok(parse_bili_search_items(&items));
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

    Ok(parse_bili_search_items(&source))
}

pub async fn search_rooms(keyword: &str) -> Result<Vec<RoomCard>, String> {
    let kw = keyword.to_owned();
    retry(2, || search_rooms_once(&kw)).await
}

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
        if let Ok(response) = request_playinfo(client, &normalized_room_id, params, cookie.as_deref()).await {
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

    // Probe every parsed source concurrently; keep only the ones that are actually reachable.
    // This removes CDN routes that fail DNS or TCP at this machine (e.g. gotcha101
    // which resolves only inside Bilibili's internal network).
    use tokio::task::JoinSet;
    let probe_urls: Vec<(String, StreamSource)> = sources
        .into_iter()
        .map(|s| (s.stream_url.clone(), s))
        .collect();
    let mut join_set = JoinSet::new();
    for (url, s) in probe_urls {
        let client = client.clone();
        join_set.spawn(async move {
            let ok = probe_source_url(&client, &url).await;
            (s, ok)
        });
    }
    let mut reachable: Vec<StreamSource> = Vec::new();
    while let Some(result) = join_set.join_next().await {
        if let Ok((s, true)) = result {
            reachable.push(s);
        }
    }

    if reachable.is_empty() {
        return Err("所有CDN路线均不可达，请检查网络".to_string());
    }

    // Collect one source per (qualityKey, format) pair, keeping the one with
    // the highest priority within that group.  This deduplicates CDN routes
    // (gotcha101 / gotcha104b / …) which all share the same quality label.
    fn best_per_quality_and_format(
        mut sources: Vec<StreamSource>,
    ) -> Vec<StreamSource> {
        sources.sort_by_key(|s| std::cmp::Reverse(source_priority(s)));
        let mut seen: HashMap<(String, String), usize> = HashMap::new();
        let mut result: Vec<StreamSource> = Vec::new();
        for (idx, s) in sources.into_iter().enumerate() {
            let fmt_str = if matches!(s.format, StreamFormat::Hls) { "hls" } else { "flv" };
            let key = (s.quality_key.clone(), fmt_str.to_string());
            let entry = seen.entry(key).or_insert(idx);
            if *entry == idx {
                result.push(s);
            }
        }
        result
    }

    let mut sources = best_per_quality_and_format(reachable);

    sources.sort_by_key(|s| std::cmp::Reverse(source_priority(s)));

    // Mark the first reachable source as default.
    if let Some(item) = sources.first_mut() {
        item.is_default = Some(true);
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
async fn save_bilibili_sessdata(sessdata: &str) {
    let map = serde_json::json!({ "SESSDATA": sessdata });
    let _ = tokio::fs::write(".bilibili_cookie_store.json", map.to_string()).await;
}

/// Reads SESSDATA from the on-disk cookie store. Returns None if absent or invalid.
pub(crate) async fn read_saved_cookie() -> Option<String> {
    let content = tokio::fs::read(".bilibili_cookie_store.json")
        .await
        .ok()?;
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&content).ok()?;
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
        let msg = payload.get("message").and_then(Value::as_str).unwrap_or("unknown");
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
        .form(&[
            ("record_id", replay_id),
            ("csrf", ""),
        ]);

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
        let msg = payload.get("message").and_then(Value::as_str).unwrap_or("unknown");
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
        let remaining = ts - std::time::SystemTime::now()
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
