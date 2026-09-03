//! Bilibili live danmaku client.
//!
//! Packet header (16 bytes, all big-endian):
//!   packet_len u32 | header_len u16(=16) | protover u16 | operation u32 | seq u32(=1)
//! operations: 2=heartbeat, 3=heartbeat reply (body: u32 BE popularity),
//!             5=notify, 7=auth, 8=auth reply.
//! protover: 0=plain JSON, 2=zlib (body decompresses to ANOTHER series of
//! full packets — parse recursively). We request protover 2 to avoid brotli.

use futures::{SinkExt, StreamExt};
use serde_json::Value;
use std::io::Read;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{emit_chat, emit_online, emit_status, ConnOutcome};
use crate::models::PlatformId;

const DANMU_INFO_ENDPOINT: &str =
    "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

fn encode_packet(op: u32, protover: u16, body: &[u8]) -> Vec<u8> {
    let total = (16 + body.len()) as u32;
    let mut out = Vec::with_capacity(total as usize);
    out.extend_from_slice(&total.to_be_bytes());
    out.extend_from_slice(&16u16.to_be_bytes());
    out.extend_from_slice(&protover.to_be_bytes());
    out.extend_from_slice(&op.to_be_bytes());
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(body);
    out
}

#[derive(Debug, PartialEq)]
struct ParsedMsg {
    kind: &'static str, // "chat" | "online" | "ready"
    user: Option<String>,
    content: Option<String>,
    color: Option<String>,
    user_level: Option<i64>,
    count: Option<i64>,
}

impl ParsedMsg {
    fn chat(user: String, content: String, color: Option<String>, user_level: Option<i64>) -> Self {
        Self {
            kind: "chat",
            user: Some(user),
            content: Some(content),
            color,
            user_level,
            count: None,
        }
    }
    fn online(count: i64) -> Self {
        Self {
            kind: "online",
            user: None,
            content: None,
            color: None,
            user_level: None,
            count: Some(count),
        }
    }
    fn ready() -> Self {
        Self {
            kind: "ready",
            user: None,
            content: None,
            color: None,
            user_level: None,
            count: None,
        }
    }
}

fn decode_packets(data: &[u8]) -> Vec<ParsedMsg> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off + 16 <= data.len() {
        let pack_len =
            u32::from_be_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]]) as usize;
        let protover = u16::from_be_bytes([data[off + 6], data[off + 7]]);
        let op = u32::from_be_bytes([data[off + 8], data[off + 9], data[off + 10], data[off + 11]]);
        if pack_len < 16 || off + pack_len > data.len() {
            break;
        }
        let body = &data[off + 16..off + pack_len];
        match op {
            3 => {
                if body.len() >= 4 {
                    let count = i32::from_be_bytes([body[0], body[1], body[2], body[3]]) as i64;
                    out.push(ParsedMsg::online(count));
                }
            }
            5 => match protover {
                2 => {
                    // zlib — decompresses to another series of full packets.
                    let mut decoder = flate2::read::ZlibDecoder::new(body);
                    let mut decompressed = Vec::new();
                    if decoder.read_to_end(&mut decompressed).is_ok() {
                        out.extend(decode_packets(&decompressed));
                    }
                }
                _ => {
                    if let Ok(json) = serde_json::from_slice::<Value>(body) {
                        handle_business(&json, &mut out);
                    }
                }
            },
            8 => out.push(ParsedMsg::ready()),
            _ => {}
        }
        off += pack_len;
    }
    out
}

fn json_i64(v: Option<&Value>) -> Option<i64> {
    match v {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.parse::<i64>().ok(),
        _ => None,
    }
}

fn handle_business(json: &Value, out: &mut Vec<ParsedMsg>) {
    let cmd = json.get("cmd").and_then(Value::as_str).unwrap_or("");
    if cmd.starts_with("DANMU_MSG") {
        // info layout (no official docs — reverse engineered, fields shift):
        //   info[0] attrs: [3]=color (int RGB)
        //   info[1] text
        //   info[2] user: [1]=uname
        //   info[4] level: [0]=user_level
        let info = match json.get("info").and_then(Value::as_array) {
            Some(a) if a.len() >= 3 => a,
            _ => return,
        };
        let content = info[1].as_str().unwrap_or("").to_string();
        if content.is_empty() {
            return;
        }
        let user = info[2]
            .as_array()
            .and_then(|u| u.get(1))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let color = info[0]
            .as_array()
            .and_then(|a| a.get(3))
            .and_then(|v| v.as_i64())
            .filter(|&c| (0..=0xFF_FFFF).contains(&c))
            .map(|c| format!("#{c:06x}"));
        let user_level = info
            .get(4)
            .and_then(Value::as_array)
            .and_then(|l| l.first())
            .and_then(|v| v.as_i64());
        out.push(ParsedMsg::chat(user, content, color, user_level));
    } else if cmd == "WATCHED_CHANGE" || cmd == "ONLINE_RANK_COUNT" {
        let count =
            json_i64(json.pointer("/data/num")).or_else(|| json_i64(json.pointer("/data/count")));
        if let Some(count) = count {
            out.push(ParsedMsg::online(count));
        }
    }
}

struct DanmuServerInfo {
    host: String,
    wss_port: u16,
    token: String,
}

async fn fetch_danmu_info(
    client: &reqwest::Client,
    room_id: &str,
    cookie: Option<&str>,
) -> Result<DanmuServerInfo, String> {
    let signed = crate::platforms::bilibili::wbi::sign_wbi(
        client,
        vec![
            ("id", room_id.to_string()),
            ("type", "0".to_string()),
            ("web_location", "444.8".to_string()),
        ],
        cookie,
    )
    .await?;

    let mut req = client
        .get(format!("{DANMU_INFO_ENDPOINT}?{signed}"))
        .header(
            reqwest::header::USER_AGENT,
            crate::platforms::bilibili::DEFAULT_UA,
        )
        .header(
            reqwest::header::REFERER,
            crate::platforms::bilibili::LIVE_REFERER,
        )
        .header(reqwest::header::ORIGIN, "https://live.bilibili.com");
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    let payload: Value = req
        .send()
        .await
        .map_err(|e| format!("getDanmuInfo request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("getDanmuInfo parse failed: {e}"))?;

    let data = payload
        .get("data")
        .ok_or_else(|| "getDanmuInfo missing data".to_string())?;
    let token = data
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "getDanmuInfo missing token".to_string())?
        .to_string();
    let host_list = data
        .get("host_list")
        .and_then(Value::as_array)
        .ok_or_else(|| "getDanmuInfo missing host_list".to_string())?;
    let first = host_list
        .first()
        .ok_or_else(|| "getDanmuInfo empty host_list".to_string())?;
    let host = first
        .get("host")
        .and_then(Value::as_str)
        .unwrap_or("broadcastlv.chat.bilibili.com")
        .to_string();
    let wss_port = first
        .get("wss_port")
        .and_then(Value::as_u64)
        .unwrap_or(443) as u16;
    Ok(DanmuServerInfo { host, wss_port, token })
}

/// (uid, buvid, cookie) for the auth packet. Anonymous fallback: uid=0 and a
/// fresh buvid3/4 from the fingerprint endpoint.
async fn resolve_auth_identity(
    app: &AppHandle,
    client: &reqwest::Client,
) -> (i64, String, Option<String>) {
    let cookie = crate::platforms::bilibili::cookie::get_bilibili_cookie(app)
        .await
        .cookie;
    let mut cookie = match cookie {
        Some(c) if !c.trim().is_empty() => c,
        _ => {
            let mut c = String::new();
            let _ = crate::platforms::bilibili::room::ensure_buvid(client, &mut c).await;
            c
        }
    };
    let buvid = cookie
        .split(';')
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| k.trim() == "buvid3")
        .map(|(_, v)| v.trim().to_string())
        .unwrap_or_default();

    // uid from nav when logged in; 0 for anonymous.
    let mut req = client.get("https://api.bilibili.com/x/web-interface/nav").header(
        reqwest::header::USER_AGENT,
        crate::platforms::bilibili::DEFAULT_UA,
    );
    if !cookie.is_empty() {
        req = req.header(reqwest::header::COOKIE, &cookie);
    }
    let uid = match req.send().await {
        Ok(resp) => resp
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.pointer("/data/mid").and_then(|m| m.as_i64()))
            .unwrap_or(0),
        Err(_) => 0,
    };
    if cookie.is_empty() {
        cookie = String::new();
    }
    (
        uid,
        buvid,
        if cookie.is_empty() { None } else { Some(cookie) },
    )
}

async fn connect_once(
    real_room_id: &str,
    app: &AppHandle,
    shutdown: &mut mpsc::Receiver<()>,
) -> ConnOutcome {
    let client = crate::platforms::http::shared_client();
    let (uid, buvid, cookie) = resolve_auth_identity(app, client).await;
    let info = match fetch_danmu_info(client, real_room_id, cookie.as_deref()).await {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!(error = %e, "bilibili getDanmuInfo failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };

    let url = format!("wss://{}:{}/sub", info.host, info.wss_port);
    let mut request = match url.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "bilibili ws request build failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };
    // Browser WebSocket cannot set these headers — one reason this layer
    // lives in Rust.
    if let Some(c) = &cookie {
        if let Ok(v) = c.parse() {
            request.headers_mut().insert("Cookie", v);
        }
    }
    if let Ok(v) = crate::platforms::bilibili::DEFAULT_UA.parse() {
        request.headers_mut().insert("User-Agent", v);
    }
    if let Ok(v) = "https://live.bilibili.com".parse() {
        request.headers_mut().insert("Origin", v);
    }

    let (ws_stream, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(x) => x,
        Err(e) => {
            tracing::warn!(error = %e, "bilibili ws connect failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };
    let (mut write, mut read) = ws_stream.split();

    let auth = serde_json::json!({
        "uid": uid,
        "roomid": real_room_id.parse::<i64>().unwrap_or(0),
        "protover": 2,
        "buvid": buvid,
        "platform": "web",
        "type": 2,
        "key": info.token,
    });
    if write
        .send(Message::Binary(
            encode_packet(7, 1, auth.to_string().as_bytes()).into(),
        ))
        .await
        .is_err()
    {
        return ConnOutcome::Disconnected { got_message: false };
    }

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await;
    let mut got_message = false;

    loop {
        tokio::select! {
            _ = shutdown.recv() => return ConnOutcome::Stop,
            _ = heartbeat.tick() => {
                if write
                    .send(Message::Binary(encode_packet(2, 1, b"{}").into()))
                    .await
                    .is_err()
                {
                    return ConnOutcome::Disconnected { got_message };
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        for m in decode_packets(&data) {
                            match m.kind {
                                "chat" => {
                                    got_message = true;
                                    emit_chat(
                                        app,
                                        PlatformId::Bilibili,
                                        real_room_id,
                                        m.user.unwrap_or_else(|| "unknown".to_string()),
                                        m.content.unwrap_or_default(),
                                        m.color,
                                        m.user_level,
                                    );
                                }
                                "online" => {
                                    if let Some(count) = m.count {
                                        emit_online(app, PlatformId::Bilibili, real_room_id, count);
                                    }
                                }
                                "ready" => {
                                    got_message = true;
                                    emit_status(app, PlatformId::Bilibili, real_room_id, "connected");
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                        return ConnOutcome::Disconnected { got_message };
                    }
                    _ => {}
                }
            }
        }
    }
}

pub async fn run(room_id: String, app: AppHandle, mut shutdown: mpsc::Receiver<()>) {
    // Resolve the real room id once (short/vanity ids redirect).
    let client = crate::platforms::http::shared_client();
    let real_room_id =
        match crate::platforms::bilibili::room::resolve_room_id_and_live(client, &room_id).await {
            Ok((id, _)) => id,
            Err(_) => room_id.clone(),
        };

    let mut backoff = 1u64;
    loop {
        match connect_once(&real_room_id, &app, &mut shutdown).await {
            ConnOutcome::Stop => {
                emit_status(&app, PlatformId::Bilibili, &real_room_id, "closed");
                return;
            }
            ConnOutcome::Disconnected { got_message } => {
                if got_message {
                    backoff = 1;
                }
                emit_status(&app, PlatformId::Bilibili, &real_room_id, "reconnecting");
                let sleep = tokio::time::sleep(Duration::from_secs(backoff));
                tokio::select! {
                    _ = sleep => {}
                    _ = shutdown.recv() => {
                        emit_status(&app, PlatformId::Bilibili, &real_room_id, "closed");
                        return;
                    }
                }
                backoff = (backoff * 2).min(30);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Live-network probe (ignored by default): verifies getDanmuInfo, the
    /// WS handshake, auth reply, and that the server actually pushes chat.
    /// Run: cargo test --lib -- --ignored probe_bilibili --nocapture
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "requires live network access"]
    async fn probe_bilibili_danmaku_live() {
        let client = crate::platforms::http::shared_client();
        let (real_room_id, _) =
            crate::platforms::bilibili::room::resolve_room_id_and_live(client, "6")
                .await
                .expect("resolve room 6");
        println!("[probe] real room id: {real_room_id}");

        let mut buvid_cookie = String::new();
        let _ = crate::platforms::bilibili::room::ensure_buvid(client, &mut buvid_cookie).await;
        let buvid = buvid_cookie
            .split(';')
            .filter_map(|kv| kv.trim().split_once('='))
            .find(|(k, _)| k.trim() == "buvid3")
            .map(|(_, v)| v.trim().to_string())
            .unwrap_or_default();
        println!("[probe] buvid: {buvid}");

        let info = fetch_danmu_info(client, &real_room_id, None)
            .await
            .expect("getDanmuInfo failed");
        println!("[probe] danmu server {}:{} token_len={}", info.host, info.wss_port, info.token.len());

        let url = format!("wss://{}:{}/sub", info.host, info.wss_port);
        let (ws, _) = tokio_tungstenite::connect_async(url).await.expect("ws connect failed");
        let (mut write, mut read) = ws.split();
        let auth = serde_json::json!({
            "uid": 0i64,
            "roomid": real_room_id.parse::<i64>().unwrap_or(0),
            "protover": 2,
            "buvid": buvid,
            "platform": "web",
            "type": 2,
            "key": info.token,
        });
        write
            .send(Message::Binary(
                encode_packet(7, 1, auth.to_string().as_bytes()).into(),
            ))
            .await
            .expect("auth send failed");

        let started = Instant::now();
        let mut ready = false;
        let mut chat = 0usize;
        let mut online = 0usize;
        while started.elapsed() < Duration::from_secs(30) && chat < 3 {
            let msg = match tokio::time::timeout(Duration::from_secs(5), read.next()).await {
                Ok(Some(Ok(m))) => m,
                Ok(Some(Err(e))) => panic!("ws error after {elapsed:?}: {e}", elapsed = started.elapsed()),
                Ok(None) => {
                    panic!("connection closed after {elapsed:?} (chat={chat}, ready={ready})", elapsed = started.elapsed());
                }
                Err(_) => continue, // 5s read idle — loop until overall deadline
            };
            if let Message::Close(_) = msg {
                panic!("server sent Close after {elapsed:?} (chat={chat}, ready={ready})", elapsed = started.elapsed());
            }
            if let Message::Binary(data) = msg {
                for m in decode_packets(&data) {
                    match m.kind {
                        "ready" => {
                            ready = true;
                            println!("[probe] auth reply received (op 8)");
                        }
                        "chat" => {
                            chat += 1;
                            println!("[probe] chat: {:?}: {:?}", m.user, m.content);
                        }
                        "online" => online += 1,
                        _ => {}
                    }
                }
            }
        }
        println!("[probe] done: ready={ready} chat={chat} online_events={online}");
        assert!(ready, "no auth reply (op 8) within 30s");
        assert!(chat >= 1, "no chat messages within 30s (room may be quiet)");
    }

    #[test]
    fn encode_packet_layout_big_endian() {
        let p = encode_packet(7, 0, b"{}");
        assert_eq!(u32::from_be_bytes([p[0], p[1], p[2], p[3]]), 18);
        assert_eq!(u16::from_be_bytes([p[4], p[5]]), 16);
        assert_eq!(u16::from_be_bytes([p[6], p[7]]), 0);
        assert_eq!(u32::from_be_bytes([p[8], p[9], p[10], p[11]]), 7);
        assert_eq!(u32::from_be_bytes([p[12], p[13], p[14], p[15]]), 1);
        assert_eq!(&p[16..], b"{}");
    }

    #[test]
    fn decode_concatenated_plain_packets() {
        let mut buf = encode_packet(
            5,
            0,
            br#"{"cmd":"DANMU_MSG","info":[[0,0,0,16777215],"hello",[0,"Alice"]]}"#,
        );
        buf.extend_from_slice(&encode_packet(
            5,
            0,
            br#"{"cmd":"DANMU_MSG","info":[[0,0,0,255],"world",[0,"Bob"]]}"#,
        ));
        let out = decode_packets(&buf);
        let texts: Vec<&str> = out.iter().filter_map(|m| m.content.as_deref()).collect();
        assert_eq!(texts, vec!["hello", "world"]);
        assert_eq!(out[0].user.as_deref(), Some("Alice"));
        assert_eq!(out[0].color.as_deref(), Some("#ffffff"));
        assert_eq!(out[1].color.as_deref(), Some("#0000ff"));
    }

    #[test]
    fn decode_zlib_packet_recursively() {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write;
        let inner = encode_packet(
            5,
            0,
            br#"{"cmd":"DANMU_MSG","info":[[0,0,0,16711680],"z",[0,"Zed"]]}"#,
        );
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&inner).unwrap();
        let compressed = enc.finish().unwrap();
        let out = decode_packets(&encode_packet(5, 2, &compressed));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].content.as_deref(), Some("z"));
        assert_eq!(out[0].color.as_deref(), Some("#ff0000"));
    }

    #[test]
    fn heartbeat_reply_yields_online_count() {
        let body = [0u8, 0, 0, 42];
        let out = decode_packets(&encode_packet(3, 0, &body));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "online");
        assert_eq!(out[0].count, Some(42));
    }

    #[test]
    fn auth_reply_yields_ready() {
        let out = decode_packets(&encode_packet(8, 0, b"{}"));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "ready");
    }

    #[test]
    fn malformed_danmu_msg_is_skipped() {
        // info array too short — must not panic
        let out = decode_packets(&encode_packet(5, 0, br#"{"cmd":"DANMU_MSG","info":[0]}"#));
        assert!(out.is_empty());
        // empty text — dropped
        let out = decode_packets(&encode_packet(
            5,
            0,
            br#"{"cmd":"DANMU_MSG","info":[[0,0,0,16777215],"",[0,"Alice"]]}"#,
        ));
        assert!(out.is_empty());
    }

    #[test]
    fn watched_change_yields_online() {
        let out = decode_packets(&encode_packet(
            5,
            0,
            br#"{"cmd":"WATCHED_CHANGE","data":{"num":12345}}"#,
        ));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "online");
        assert_eq!(out[0].count, Some(12345));
    }
}
