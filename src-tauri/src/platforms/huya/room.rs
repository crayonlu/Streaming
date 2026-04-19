use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use md5::{Digest, Md5};
use rand::Rng;
use regex::Regex;
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, ORIGIN, REFERER, USER_AGENT};
use serde_json::Value;

use super::{normalize_url, value_to_string, DESKTOP_UA, MOBILE_UA};
use crate::models::{PlatformId, RoomDetail, StreamFormat, StreamSource};
use crate::platforms::http::shared_client;

#[derive(Clone, Debug)]
pub(crate) struct HuyaRoomPayload {
    pub normalized_room_id: String,
    pub title: String,
    pub streamer_name: String,
    pub avatar_url: Option<String>,
    pub cover_url: Option<String>,
    pub area_name: Option<String>,
    pub is_live: bool,
}

#[derive(Clone, Debug)]
struct WebStreamCandidate {
    base_flv: String,
    cdn: String,
}

fn md5_hex(input: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn current_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as i64
}

fn parse_query(qs: &str) -> HashMap<String, String> {
    url::form_urlencoded::parse(qs.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

fn url_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("a={s}").as_bytes())
        .find(|(k, _)| k == "a")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| s.to_string())
}

fn generate_web_anti_code(stream_name: &str, anti_code: &str) -> Result<String, String> {
    let sanitized = anti_code.replace("&amp;", "&");
    let params = parse_query(sanitized.trim_start_matches(['?', '&']));

    let fm_value = params
        .get("fm")
        .ok_or_else(|| "missing fm in anti code".to_string())?;
    let ctype = params
        .get("ctype")
        .cloned()
        .ok_or_else(|| "missing ctype in anti code".to_string())?;
    let fs = params
        .get("fs")
        .cloned()
        .ok_or_else(|| "missing fs in anti code".to_string())?;

    let fm_decoded = url_decode(fm_value);
    let fm_bytes = general_purpose::STANDARD
        .decode(fm_decoded.as_bytes())
        .map_err(|_| "failed to decode fm base64".to_string())?;
    let fm_plain =
        String::from_utf8(fm_bytes).map_err(|_| "failed to decode fm utf-8".to_string())?;
    let ws_prefix = fm_plain
        .split('_')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "failed to derive wsSecret prefix".to_string())?;

    let params_t = 100_i64;
    let sdk_version = 2403051612_i64;
    let t13 = current_millis();
    let sdk_sid = t13;
    let mut rng = rand::thread_rng();
    let uid = rng.gen_range(1_400_000_000_000_i64..=1_400_009_999_999_i64);
    let seq_id = uid + sdk_sid;
    let ws_time = format!("{:x}", (t13 + 110_624) / 1000);
    let init_uuid =
        ((t13 % 10_000_000_000_i64) * 1_000 + rng.gen_range(0_i64..1_000_i64)) % 4_294_967_295_i64;

    let ws_secret_hash = md5_hex(&format!("{seq_id}|{ctype}|{params_t}"));
    let ws_secret_plain = format!("{ws_prefix}_{uid}_{stream_name}_{ws_secret_hash}_{ws_time}");
    let ws_secret_md5 = md5_hex(&ws_secret_plain);

    Ok(vec![
        ("wsSecret", ws_secret_md5),
        ("wsTime", ws_time),
        ("seqid", seq_id.to_string()),
        ("ctype", ctype),
        ("ver", "1".to_string()),
        ("fs", fs),
        ("uuid", init_uuid.to_string()),
        ("u", uid.to_string()),
        ("t", params_t.to_string()),
        ("sv", sdk_version.to_string()),
        ("sdk_sid", sdk_sid.to_string()),
        ("codec", "264".to_string()),
    ]
    .into_iter()
    .map(|(k, v)| format!("{k}={v}"))
    .collect::<Vec<_>>()
    .join("&"))
}

pub(crate) async fn fetch_room_detail_payload(room_id: &str) -> Result<HuyaRoomPayload, String> {
    let payload: Value = shared_client()
        .get("https://mp.huya.com/cache.php")
        .header(ACCEPT, "*/*")
        .header(ORIGIN, "https://m.huya.com")
        .header(REFERER, "https://m.huya.com/")
        .header(USER_AGENT, MOBILE_UA)
        .query(&[
            ("m", "Live"),
            ("do", "profileRoom"),
            ("roomid", room_id),
            ("showSecret", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("huya room detail request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("huya room detail status error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("huya room detail parse error: {e}"))?;

    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    let live_data = data.get("liveData").cloned().unwrap_or(Value::Null);
    let normalized_room_id = value_to_string(
        live_data
            .get("profileRoom")
            .or_else(|| live_data.get("roomId"))
            .or_else(|| data.get("profileRoom")),
    );
    let normalized_room_id = if normalized_room_id.is_empty() {
        room_id.to_string()
    } else {
        normalized_room_id
    };
    let title = value_to_string(
        live_data
            .get("introduction")
            .or_else(|| live_data.get("roomName")),
    );
    let streamer_name = value_to_string(live_data.get("nick"));
    let avatar = normalize_url(&value_to_string(
        live_data
            .get("avatar180")
            .or_else(|| live_data.get("avatar")),
    ));
    let cover = normalize_url(&value_to_string(
        live_data
            .get("screenshot")
            .or_else(|| live_data.get("roomCover")),
    ));
    let area_name = live_data
        .get("gameFullName")
        .or_else(|| live_data.get("gameName"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let is_live = data.get("stream").is_some()
        || live_data
            .get("liveStatus")
            .or_else(|| live_data.get("eLiveStatus"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            == 2;

    Ok(HuyaRoomPayload {
        normalized_room_id,
        title,
        streamer_name,
        avatar_url: if avatar.is_empty() {
            None
        } else {
            Some(avatar)
        },
        cover_url: if cover.is_empty() { None } else { Some(cover) },
        area_name,
        is_live,
    })
}

async fn fetch_web_stream_candidates(room_id: &str) -> Result<Vec<WebStreamCandidate>, String> {
    let mut candidates = fetch_web_stream_candidates_with_headers(room_id, false).await?;
    if candidates.is_empty() {
        candidates = fetch_web_stream_candidates_with_headers(room_id, true).await?;
    }
    Ok(prioritize_candidates(candidates))
}

async fn fetch_web_stream_candidates_with_headers(
    room_id: &str,
    mobile: bool,
) -> Result<Vec<WebStreamCandidate>, String> {
    let mut request = shared_client()
        .get(format!("https://www.huya.com/{room_id}"))
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.8,en-US;q=0.3")
        .header(
            reqwest::header::COOKIE,
            "huya_ua=webh5&0.1.0&websocket; udb_passdata=3",
        );

    if mobile {
        request = request
            .header(USER_AGENT, MOBILE_UA)
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header(REFERER, "https://m.huya.com/");
    } else {
        request = request
            .header(USER_AGENT, DESKTOP_UA)
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header(REFERER, "https://www.huya.com/");
    }

    let html = request
        .send()
        .await
        .map_err(|e| format!("huya room page request failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("huya room page read failed: {e}"))?;

    let re = Regex::new(r#"(?s)stream:\s*(\{"data".*?),"iWebDefaultBitRate""#)
        .map_err(|e| e.to_string())?;
    let Some(caps) = re.captures(&html) else {
        return Ok(Vec::new());
    };
    let json_fragment = caps.get(1).map(|m| m.as_str()).unwrap_or("");
    let value: Value =
        serde_json::from_str(&format!("{json_fragment}}}")).map_err(|e| e.to_string())?;
    let stream_items = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
        .and_then(|item| item.get("gameStreamInfoList"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut candidates = Vec::new();
    for item in stream_items {
        let cdn = value_to_string(item.get("sCdnType"));
        let flv_url = value_to_string(item.get("sFlvUrl"));
        let stream_name = value_to_string(item.get("sStreamName"));
        let flv_suffix = value_to_string(item.get("sFlvUrlSuffix"));
        let anti_code = value_to_string(item.get("sFlvAntiCode"));
        if flv_url.is_empty()
            || stream_name.is_empty()
            || flv_suffix.is_empty()
            || anti_code.is_empty()
        {
            continue;
        }

        let anti_params = generate_web_anti_code(&stream_name, &anti_code)?;
        candidates.push(WebStreamCandidate {
            base_flv: normalize_url(&format!(
                "{flv_url}/{stream_name}.{flv_suffix}?{anti_params}"
            )),
            cdn,
        });
    }

    Ok(candidates)
}

fn cdn_priority(cdn: &str) -> usize {
    if cdn.eq_ignore_ascii_case("tx") {
        0
    } else if cdn.eq_ignore_ascii_case("al") {
        1
    } else if cdn.eq_ignore_ascii_case("hs") {
        2
    } else {
        3
    }
}

fn prioritize_candidates(mut candidates: Vec<WebStreamCandidate>) -> Vec<WebStreamCandidate> {
    candidates.sort_by_key(|c| cdn_priority(&c.cdn));
    candidates
}

fn adjust_stream_url(url: &str, cdn: &str) -> String {
    if cdn.eq_ignore_ascii_case("tx") {
        normalize_url(
            &url.replace("&ctype=tars_mp", "&ctype=huya_webh5")
                .replace("&fs=bhct", "&fs=bgct"),
        )
    } else {
        normalize_url(url)
    }
}

fn quality_variants(base: &str) -> Vec<(&'static str, &'static str, String)> {
    let mut variants = vec![("source", "原画", base.to_string())];
    if base.to_ascii_lowercase().contains(".flv") {
        variants.push(("4000", "高清", format!("{base}&ratio=4000")));
        variants.push(("2000", "标清", format!("{base}&ratio=2000")));
    }
    variants
}

pub async fn get_room_detail(room_id: &str) -> Result<RoomDetail, String> {
    let detail = fetch_room_detail_payload(room_id).await?;
    Ok(RoomDetail {
        id: format!("huya-{}", detail.normalized_room_id),
        platform: PlatformId::Huya,
        room_id: detail.normalized_room_id,
        title: detail.title,
        streamer_name: detail.streamer_name,
        avatar_url: detail.avatar_url,
        cover_url: detail.cover_url,
        area_name: detail.area_name,
        description: None,
        is_live: detail.is_live,
        followed: false,
    })
}

pub async fn get_stream_sources(room_id: &str) -> Result<Vec<StreamSource>, String> {
    let detail = fetch_room_detail_payload(room_id).await?;
    if !detail.is_live {
        return Err("主播未开播".to_string());
    }

    let candidates = fetch_web_stream_candidates(&detail.normalized_room_id).await?;
    let Some(candidate) = candidates.first() else {
        return Err("未获取到可用播放源".to_string());
    };
    let base = adjust_stream_url(&candidate.base_flv, &candidate.cdn);
    let cdn_label = match candidate.cdn.to_ascii_lowercase().as_str() {
        "tx" => "腾讯线路",
        "al" => "阿里线路",
        "hs" => "虎牙线路",
        _ => "主线路",
    };

    Ok(quality_variants(&base)
        .into_iter()
        .enumerate()
        .map(|(idx, (key, label, stream_url))| StreamSource {
            id: format!("huya-{key}-{idx}"),
            platform: PlatformId::Huya,
            room_id: detail.normalized_room_id.clone(),
            quality_key: key.to_string(),
            quality_label: label.to_string(),
            stream_url,
            format: StreamFormat::Flv,
            is_default: Some(idx == 0),
            cdn: Some(cdn_label.to_string()),
        })
        .collect())
}
