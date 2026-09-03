//! Huya stream signing via Tars/WUP RPC (getCdnTokenInfoEx).
//!
//! Huya's anti-crawl evolved: the old client-side anticode (random uid,
//! self-computed wsTime — still in room.rs as the legacy fallback) is being
//! phased out. The current flow, verified against DTV's MIT implementation:
//!
//!   1. profileRoom → baseSteamInfoList → {sFlvUrl, sStreamName, lChannelId}
//!   2. WUP RPC to wup.huya.com (servant "liveui", func "getCdnTokenInfoEx")
//!      exchanges those for a short-lived `sFlvToken`
//!   3. The anticode is rebuilt from the token: wsTime passes through
//!      unchanged, the uid side is derived from the *presenter's* uid
//!      (lChannelId) — never a random one
//!   4. Playback requests must carry the official HYSDK UA or the CDN
//!      rejects them (injected by proxy.rs's /live route)

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use md5::{Digest, Md5};
use rand::Rng;

use super::jce::{JceDecoder, JceEncoder};

pub(crate) const HUYA_HYSDK_UA: &str =
    "HYSDK(Windows,30000002)_APP(pc_exe&7080000&official)_SDK(trans&2.34.0.5795)";

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

fn url_encode_component(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()
}

pub(crate) fn enforce_https(url: &str) -> String {
    if url.starts_with("https://") {
        url.to_string()
    } else if let Some(rest) = url.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        url.to_string()
    }
}

/// 32-bit rotate-left by 8 of the low word, high bits preserved.
fn rotl32_by8_in_i64(value: i64) -> i64 {
    let low = (value as u64 & 0xFFFF_FFFF) as u32;
    let rotated = low.rotate_left(8) as i64;
    let high = value & !0xFFFF_FFFFi64;
    high | rotated
}

/// Rebuild the anticode query string from the WUP-issued token.
/// `anti_code` here is the token returned by getCdnTokenInfoEx.
pub(crate) fn build_huya_anti_code(
    stream_name: &str,
    presenter_uid: i64,
    anti_code: &str,
) -> Result<String, String> {
    let sanitized = anti_code.replace("&amp;", "&");
    let trimmed = sanitized.trim_start_matches(['?', '&']);
    let params = parse_query(trimmed);

    let Some(fm_raw) = params.get("fm").cloned() else {
        // Upstream already returned a usable query string.
        return Ok(trimmed.to_string());
    };

    let ctype = params
        .get("ctype")
        .cloned()
        .unwrap_or_else(|| "huya_pc_exe".to_string());

    let platform_id: i64 = params
        .get("t")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let is_wap = platform_id == 103;

    let seq_id = presenter_uid + current_millis();
    let secret_hash = md5_hex(&format!("{seq_id}|{ctype}|{platform_id}"));

    let convert_uid = rotl32_by8_in_i64(presenter_uid);
    let calc_uid = if is_wap { presenter_uid } else { convert_uid };

    let fm_decoded = url_decode(&fm_raw);
    let fm_bytes = general_purpose::STANDARD
        .decode(fm_decoded.as_bytes())
        .map_err(|_| "failed to decode fm base64".to_string())?;
    let fm_plain =
        String::from_utf8(fm_bytes).map_err(|_| "failed to decode fm utf-8".to_string())?;
    let secret_prefix = fm_plain
        .split('_')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "failed to derive wsSecret prefix".to_string())?;

    // wsTime must pass through unchanged from the upstream token.
    let ws_time = params
        .get("wsTime")
        .cloned()
        .ok_or_else(|| "missing wsTime in anti code".to_string())?;

    let ws_secret = md5_hex(&format!(
        "{secret_prefix}_{calc_uid}_{stream_name}_{secret_hash}_{ws_time}"
    ));

    let fs = params
        .get("fs")
        .cloned()
        .ok_or_else(|| "missing fs in anti code".to_string())?;

    let ws_time_int = i64::from_str_radix(ws_time.trim(), 16).unwrap_or(0);
    let mut rng = rand::thread_rng();
    let ct = (((ws_time_int as f64) + rng.gen::<f64>()) * 1000.0) as i64;
    let uuid =
        ((((ct % 10_000_000_000i64) as f64) + rng.gen::<f64>()) * 1000.0 % (0xFFFF_FFFFu64 as f64))
            as u32;

    let mut parts: Vec<(String, String)> = vec![
        ("wsSecret".to_string(), ws_secret),
        ("wsTime".to_string(), ws_time),
        ("seqid".to_string(), seq_id.to_string()),
        ("ctype".to_string(), ctype),
        ("ver".to_string(), "1".to_string()),
        ("fs".to_string(), fs),
        // Keep fm url-encoded, as the official clients send it.
        ("fm".to_string(), url_encode_component(&fm_raw)),
        ("t".to_string(), platform_id.to_string()),
    ];
    if is_wap {
        parts.push(("uid".to_string(), presenter_uid.to_string()));
        parts.push(("uuid".to_string(), uuid.to_string()));
    } else {
        parts.push(("u".to_string(), convert_uid.to_string()));
    }

    Ok(parts
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&"))
}

// ── WUP RPC (getCdnTokenInfoEx) ──────────────────────────────────────────────

/// GetCdnTokenExReq fields:
///   0 sFlvUrl, 1 sStreamName, 2 iLoopTime, 3 tId(HuyaUserId), 4 iAppId
/// HuyaUserId fields:
///   0 lUid, 1 sGuid, 2 sToken, 3 sHuyaUA, 4 sCookie, 5 iTokenType,
///   6 sDeviceInfo, 7 sQimei
fn encode_cdn_token_req(flv_url: &str, stream_name: &str) -> Vec<u8> {
    let mut uid = JceEncoder::new();
    uid.write_int64(0, 0);
    uid.write_string(1, "");
    uid.write_string(2, "");
    uid.write_string(3, "pc_exe&7060000&official");
    uid.write_string(4, "");
    uid.write_int32(5, 0);
    uid.write_string(6, "");
    uid.write_string(7, "");

    let mut req = JceEncoder::new();
    req.write_string(0, flv_url);
    req.write_string(1, stream_name);
    req.write_int32(2, 0);
    req.write_struct_raw(3, &uid.to_bytes());
    req.write_int32(4, 66);
    req.to_bytes()
}

/// RequestPacket: 1 iVersion=3, 2 cPacketType=0, 3 iMessageType=0,
/// 4 iRequestId, 5 sServantName, 6 sFuncName, 7 sBuffer, 8 iTimeout,
/// 9 context, 10 status — prefixed with 4-byte BE total length.
fn encode_wup_request(request_id: i32, servant: &str, func: &str, payload: &[u8]) -> Vec<u8> {
    let mut e = JceEncoder::new();
    e.write_int16(1, 3);
    e.write_int8(2, 0);
    e.write_int32(3, 0);
    e.write_int32(4, request_id);
    e.write_string(5, servant);
    e.write_string(6, func);
    e.write_bytes(7, payload);
    e.write_int32(8, 0);
    e.write_empty_map(9);
    e.write_empty_map(10);
    let body = e.to_bytes();

    let total = (body.len() + 4) as u32;
    let mut out = Vec::with_capacity(body.len() + 4);
    out.extend_from_slice(&total.to_be_bytes());
    out.extend_from_slice(&body);
    out
}

/// Decode a WUP response into (iRet, sBuffer, sResultDesc). Huya answers
/// with either the standard ResponsePacket layout (sBuffer at tag 6) or a
/// request-like layout (sBuffer at tag 7) — try both.
fn decode_wup_response(buf: &[u8]) -> Result<(i32, Vec<u8>, String), String> {
    let payload = if buf.len() >= 4 {
        let declared = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        if declared >= 4 && declared <= buf.len() {
            &buf[4..declared]
        } else {
            buf
        }
    } else {
        buf
    };

    // Layout A: tags 1..8 = iVersion, cPacketType, iRequestId, iMessageType,
    // iRet, sBuffer, status, sResultDesc.
    {
        let mut d = JceDecoder::new(payload);
        let _ = d.read_int16(1, 0);
        let _ = d.read_int8(2, 0);
        let _ = d.read_int32(3, 0);
        let _ = d.read_int32(4, 0);
        if let Ok(ret) = d.read_int32(5, -1) {
            if let Ok(Some(s_buffer)) = d.read_bytes(6) {
                let desc = d.read_string(8, String::new()).unwrap_or_default();
                return Ok((ret, s_buffer, desc));
            }
        }
    }

    // Layout B: tags 1..10 = iVersion, cPacketType, iMessageType, iRequestId,
    // sServantName, sFuncName, sBuffer, iTimeout, context, status.
    let mut d = JceDecoder::new(payload);
    let _ = d.read_int16(1, 0);
    let _ = d.read_int8(2, 0);
    let _ = d.read_int32(3, 0);
    let _ = d.read_int32(4, 0);
    let _ = d.read_string(5, String::new());
    let _ = d.read_string(6, String::new());
    let s_buffer = d
        .read_bytes(7)?
        .ok_or_else(|| "wup: missing sBuffer".to_string())?;
    Ok((0, s_buffer, String::new()))
}

pub(crate) async fn huya_get_cdn_token_info_ex(
    client: &reqwest::Client,
    flv_url: &str,
    stream_name: &str,
) -> Result<String, String> {
    let req_bytes = encode_cdn_token_req(flv_url, stream_name);

    // UniAttribute: map<string, bytes> { "tReq": GetCdnTokenExReq }
    let mut tup = JceEncoder::new();
    tup.write_map_string_bytes(0, &[("tReq".to_string(), req_bytes)]);

    let packet = encode_wup_request(1, "liveui", "getCdnTokenInfoEx", &tup.to_bytes());

    let resp = client
        .post("http://wup.huya.com")
        .header(reqwest::header::USER_AGENT, HUYA_HYSDK_UA)
        .header(reqwest::header::ORIGIN, "https://m.huya.com/")
        .header(reqwest::header::REFERER, "https://m.huya.com/")
        .header(reqwest::header::ACCEPT, "*/*")
        .header("Content-Type", "application/octet-stream")
        .body(packet)
        .send()
        .await
        .map_err(|e| format!("huya WUP request failed: {e}"))?;

    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("huya WUP read failed: {e}"))?;
    if !status.is_success() {
        let snippet = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).to_string();
        return Err(format!("huya WUP http {status}: {snippet}"));
    }

    let (ret, s_buffer, desc) = decode_wup_response(&bytes)?;
    if ret != 0 {
        return Err(if desc.is_empty() {
            format!("huya WUP returned ret={ret}")
        } else {
            format!("huya WUP returned ret={ret}: {desc}")
        });
    }

    // UniAttribute — flat layout first: map<string, bytes> { "tRsp": Resp }.
    {
        let mut d = JceDecoder::new(&s_buffer);
        if let Ok(Some(entries)) = d.read_map_string_bytes(0) {
            if let Some((_, v)) = entries.iter().find(|(k, _)| k == "tRsp") {
                let mut rd = JceDecoder::new(v);
                let token = rd.read_string(0, String::new())?;
                if !token.trim().is_empty() {
                    return Ok(token);
                }
            }
        }
    }

    // Complex layout: map<string, map<string, bytes>>.
    let mut d = JceDecoder::new(&s_buffer);
    if let Some(entries) = d.read_map_string_map_bytes(0)? {
        if let Some((_, inner)) = entries.iter().find(|(k, _)| k == "tRsp") {
            for (_, v) in inner {
                let mut rd = JceDecoder::new(v);
                if let Ok(token) = rd.read_string(0, String::new()) {
                    if !token.trim().is_empty() {
                        return Ok(token);
                    }
                }
            }
        }
    }

    Err("huya WUP returned no decodable token".to_string())
}

// ── Stream candidate / bitrate extraction ────────────────────────────────────

#[derive(Clone, Debug)]
pub(crate) struct HuyaStreamCandidate {
    pub cdn: String,
    pub flv_url: String,
    pub stream_name: String,
    pub presenter_uid: i64,
}

fn parse_i64_lossy(v: Option<&serde_json::Value>) -> i64 {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

pub(crate) fn cdn_priority(cdn: &str) -> usize {
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

/// huya.com-domain lines first, then other FLV lines, then the rest.
fn prioritize_candidates(candidates: Vec<HuyaStreamCandidate>) -> Vec<HuyaStreamCandidate> {
    let mut huya_domain = Vec::new();
    let mut other = Vec::new();
    for c in candidates {
        if c.flv_url.to_ascii_lowercase().contains("huya.com") {
            huya_domain.push(c);
        } else {
            other.push(c);
        }
    }
    if !huya_domain.is_empty() {
        huya_domain.extend(other);
        huya_domain
    } else {
        other
    }
}

/// Extract stream candidates from the profileRoom payload we already fetch
/// for room details (data.stream.baseSteamInfoList).
pub(crate) fn extract_stream_candidates(profile: &serde_json::Value) -> Vec<HuyaStreamCandidate> {
    let Some(data) = profile.get("data") else {
        return Vec::new();
    };
    let base_list = data
        .get("stream")
        .and_then(|x| x.get("baseSteamInfoList"))
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();

    let fallback_uid = base_list
        .first()
        .map(|x| parse_i64_lossy(x.get("lChannelId")))
        .unwrap_or(0);

    let mut items: Vec<(usize, HuyaStreamCandidate)> = Vec::new();
    for item in &base_list {
        let cdn = item
            .get("sCdnType")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let flv_url = item
            .get("sFlvUrl")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let stream_name = item
            .get("sStreamName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let uid_raw = parse_i64_lossy(item.get("lChannelId"));
        let presenter_uid = if uid_raw != 0 { uid_raw } else { fallback_uid };
        if cdn.is_empty() || flv_url.is_empty() || stream_name.is_empty() || presenter_uid == 0 {
            continue;
        }
        let prio = cdn_priority(&cdn);
        items.push((
            prio,
            HuyaStreamCandidate {
                cdn,
                flv_url: flv_url.trim_end_matches('/').to_string(),
                stream_name,
                presenter_uid,
            },
        ));
    }
    items.sort_by_key(|(prio, _)| *prio);
    prioritize_candidates(items.into_iter().map(|(_, c)| c).collect())
}

/// Real bitrate ladders from liveData.bitRateInfo (stringified JSON),
/// falling back to stream.flv.rateArray. Sorted, deduped, ascending.
pub(crate) fn extract_available_bitrates(profile: &serde_json::Value) -> Vec<i32> {
    let Some(data) = profile.get("data") else {
        return Vec::new();
    };

    let mut out: Vec<i32> = Vec::new();
    if let Some(s) = data
        .get("liveData")
        .and_then(|x| x.get("bitRateInfo"))
        .and_then(|x| x.as_str())
    {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
            if let Some(arr) = v.as_array() {
                for item in arr {
                    if let Some(br) = item.get("iBitRate").and_then(|x| x.as_i64()) {
                        if br > 0 {
                            out.push(br as i32);
                        }
                    }
                }
            }
        }
    }

    if out.is_empty() {
        if let Some(arr) = data
            .get("stream")
            .and_then(|x| x.get("flv"))
            .and_then(|x| x.get("rateArray"))
            .and_then(|x| x.as_array())
        {
            for item in arr {
                if let Some(br) = item.get("iBitRate").and_then(|x| x.as_i64()) {
                    if br > 0 {
                        out.push(br as i32);
                    }
                }
            }
        }
    }

    out.sort_unstable();
    out.dedup();
    out
}

/// Fetch (ayyuid, top_sid) — used by the danmaku client (Task 10).
#[allow(dead_code)] // consumed by the danmaku module
pub(crate) async fn fetch_huya_ids(room_id: &str) -> Result<(i64, i64), String> {
    let url = format!(
        "https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid={room_id}&showSecret=1"
    );
    let v: serde_json::Value = crate::platforms::http::shared_client()
        .get(&url)
        .header(reqwest::header::USER_AGENT, super::DESKTOP_UA)
        .header(reqwest::header::ORIGIN, "https://www.huya.com")
        .header(reqwest::header::REFERER, "https://www.huya.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let data = v.get("data").ok_or_else(|| "missing data".to_string())?;
    let ayyuid = data
        .get("profileInfo")
        .and_then(|x| x.get("yyid"))
        .and_then(|x| x.as_i64())
        .unwrap_or(0);
    let top_sid = data
        .get("stream")
        .and_then(|x| x.get("baseSteamInfoList"))
        .and_then(|x| x.as_array())
        .and_then(|a| a.first())
        .and_then(|x| x.get("lChannelId"))
        .and_then(|x| x.as_i64())
        .unwrap_or(0);
    if top_sid == 0 {
        return Err("未找到频道ID，房间可能未开播".to_string());
    }
    Ok((ayyuid, top_sid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotl32_by8_rotates_low_word() {
        assert_eq!(rotl32_by8_in_i64(0x12345678), 0x34567812);
        assert_eq!(rotl32_by8_in_i64(0), 0);
        // high bits preserved
        assert_eq!(rotl32_by8_in_i64(0xABCD_0000_0001i64), 0xABCD_0000_0100i64);
    }

    #[test]
    fn anti_code_uses_presenter_uid_and_upstream_ws_time() {
        // fm = base64("dGVzdA_predator") → url-encoded; secret prefix = "dGVzdA"
        let fm = url_encode_component(&general_purpose::STANDARD.encode("dGVzdA_predator"));
        let anti = format!("wsTime=64b9e244&fm={fm}&ctype=huya_pc_exe&fs=bgct&t=100");
        let out = build_huya_anti_code("stream123", 888_000_001, &anti).expect("build anti code");

        let params = parse_query(&out);
        assert_eq!(
            params.get("wsTime").unwrap(),
            "64b9e244",
            "wsTime must pass through unchanged"
        );
        assert_eq!(
            params.get("u").unwrap(),
            &rotl32_by8_in_i64(888_000_001).to_string()
        );
        assert!(params.get("wsSecret").is_some_and(|s| s.len() == 32));
        assert_eq!(params.get("ctype").unwrap(), "huya_pc_exe");
        assert!(params.get("uuid").is_none(), "uuid only on wap (t=103)");
    }

    #[test]
    fn anti_code_wap_branch_uses_presenter_uid_and_uuid() {
        let fm = url_encode_component(&general_purpose::STANDARD.encode("dGVzdA_predator"));
        let anti = format!("wsTime=64b9e244&fm={fm}&ctype=huya_pc_exe&fs=bgct&t=103");
        let out = build_huya_anti_code("stream123", 888_000_001, &anti).expect("build anti code");

        let params = parse_query(&out);
        assert_eq!(params.get("uid").unwrap(), "888000001");
        assert!(params.get("uuid").is_some());
        assert!(params.get("u").is_none(), "wap uses uid, not u");
    }

    #[test]
    fn wup_request_packet_round_trip() {
        let req_bytes = encode_cdn_token_req("https://tx.flv.huya.com/src", "stream123");
        // UniAttribute wrap, same as huya_get_cdn_token_info_ex
        let mut tup = JceEncoder::new();
        tup.write_map_string_bytes(0, &[("tReq".to_string(), req_bytes)]);
        let packet = encode_wup_request(1, "liveui", "getCdnTokenInfoEx", &tup.to_bytes());

        // 4-byte BE length prefix covers itself + body
        let declared = u32::from_be_bytes([packet[0], packet[1], packet[2], packet[3]]) as usize;
        assert_eq!(declared, packet.len());

        let mut d = JceDecoder::new(&packet[4..]);
        assert_eq!(d.read_int16(1, 0).unwrap(), 3);
        assert_eq!(d.read_int8(2, -1).unwrap(), 0);
        assert_eq!(d.read_int32(3, -1).unwrap(), 0);
        assert_eq!(d.read_int32(4, -1).unwrap(), 1);
        assert_eq!(d.read_string(5, String::new()).unwrap(), "liveui");
        assert_eq!(d.read_string(6, String::new()).unwrap(), "getCdnTokenInfoEx");
        let buf = d.read_bytes(7).unwrap().unwrap();
        // sBuffer is the UniAttribute map; decode the request back out
        let mut ud = JceDecoder::new(&buf);
        let entries = ud.read_map_string_bytes(0).unwrap().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "tReq");
        let mut rd = JceDecoder::new(&entries[0].1);
        assert_eq!(
            rd.read_string(0, String::new()).unwrap(),
            "https://tx.flv.huya.com/src"
        );
        assert_eq!(rd.read_string(1, String::new()).unwrap(), "stream123");
        assert_eq!(rd.read_int32(2, -1).unwrap(), 0);
        assert!(rd.read_struct_begin(3).unwrap());
        assert_eq!(rd.read_string(3, String::new()).unwrap(), "pc_exe&7060000&official");
        rd.read_struct_end().unwrap();
        assert_eq!(rd.read_int32(4, -1).unwrap(), 66);
    }

    #[test]
    fn wup_response_layout_b_decodes() {
        // Craft a layout-B (request-like) response carrying a UniAttribute
        // flat map { "tRsp": GetCdnTokenExResp } in sBuffer (tag 7).
        let mut rsp = JceEncoder::new();
        rsp.write_string(0, "wsTime=abc&fm=xyz");
        let mut ua = JceEncoder::new();
        ua.write_map_string_bytes(0, &[("tRsp".to_string(), rsp.to_bytes())]);

        let mut e = JceEncoder::new();
        e.write_int16(1, 3);
        e.write_int8(2, 0);
        e.write_int32(3, 0);
        e.write_int32(4, 1);
        e.write_string(5, "liveui");
        e.write_string(6, "getCdnTokenInfoEx");
        e.write_bytes(7, &ua.to_bytes());
        e.write_int32(8, 0);
        e.write_empty_map(9);
        e.write_empty_map(10);
        let body = e.to_bytes();
        let mut packet = Vec::new();
        packet.extend_from_slice(&((body.len() + 4) as u32).to_be_bytes());
        packet.extend_from_slice(&body);

        let (ret, s_buffer, _) = decode_wup_response(&packet).unwrap();
        assert_eq!(ret, 0);
        let mut d = JceDecoder::new(&s_buffer);
        let entries = d.read_map_string_bytes(0).unwrap().unwrap();
        let mut rd = JceDecoder::new(&entries[0].1);
        assert_eq!(rd.read_string(0, String::new()).unwrap(), "wsTime=abc&fm=xyz");
    }

    #[test]
    fn candidates_sorted_tx_al_hs_then_others() {
        let profile = serde_json::json!({
            "data": {
                "stream": {
                    "baseSteamInfoList": [
                        { "sCdnType": "hs", "sFlvUrl": "https://hs.flv.huya.com/src", "sStreamName": "s1", "lChannelId": 111 },
                        { "sCdnType": "tx", "sFlvUrl": "https://tx.flv.huya.com/src", "sStreamName": "s2", "lChannelId": 111 },
                        { "sCdnType": "al", "sFlvUrl": "https://al.flv.other.com/src", "sStreamName": "s3", "lChannelId": 111 }
                    ]
                }
            }
        });
        let candidates = extract_stream_candidates(&profile);
        assert_eq!(candidates.len(), 3);
        // tx first (priority 0, huya.com domain); al deprioritized by domain
        assert_eq!(candidates[0].cdn, "tx");
        assert_eq!(candidates[1].cdn, "hs");
        assert_eq!(candidates[2].cdn, "al");
        assert_eq!(candidates[0].presenter_uid, 111);
    }

    #[test]
    fn bitrates_from_stringified_bitrate_info() {
        let profile = serde_json::json!({
            "data": {
                "liveData": {
                    "bitRateInfo": "[{\"iBitRate\":2000},{\"iBitRate\":4000},{\"iBitRate\":0}]"
                }
            }
        });
        assert_eq!(extract_available_bitrates(&profile), vec![2000, 4000]);
    }
}
