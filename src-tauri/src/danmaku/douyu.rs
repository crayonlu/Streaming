//! Douyu danmaku client.
//!
//! Protocol (no signing needed — simplest of the three platforms):
//!   wss://danmuproxy.douyu.com:8506/  with `Sec-WebSocket-Protocol: binary`
//!   Frame layout (all little-endian):
//!     len u32 | len u32 | 689 u16 | encrypted u8(0) | reserved u8(0) | body | 0x00
//!     where len = body + 9 (excludes the 4 leading length bytes).
//!   Body is STT text: `@=` separates k/v, `/` separates fields,
//!   `@S` escapes `/`, `@A` escapes `@`.
//!   Join: `type@=loginreq/roomid@={rid}/` then `type@=joingroup/rid={rid}/gid@=-9999/`
//!   Heartbeat every 45s: `type@=mrkl/`
//!   Chat: `type=chatmsg` with nn (nick) / txt (text) / col (color enum 1-6).

use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{emit_chat, emit_status, ConnOutcome};
use crate::models::PlatformId;

const WS_URL: &str = "wss://danmuproxy.douyu.com:8506/";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(45);

fn encode_frame(msg: &str) -> Vec<u8> {
    let body = msg.as_bytes();
    let packet_len = (body.len() + 9) as u32;
    let mut out = Vec::with_capacity(body.len() + 13);
    out.extend_from_slice(&packet_len.to_le_bytes());
    out.extend_from_slice(&packet_len.to_le_bytes());
    out.extend_from_slice(&689u16.to_le_bytes());
    out.push(0);
    out.push(0);
    out.extend_from_slice(body);
    out.push(0);
    out
}

/// A single WS binary message may concatenate several length-prefixed frames.
fn decode_frames(data: &[u8]) -> Vec<HashMap<String, String>> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off + 12 <= data.len() {
        let len =
            u32::from_le_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]]) as usize;
        let frame_end = off + 4 + len; // len excludes its own 4 bytes
        if len < 9 || frame_end > data.len() {
            break; // truncated tail — drop it
        }
        let body = &data[off + 12..frame_end - 1]; // strip header + trailing 0x00
        out.push(parse_stt(&String::from_utf8_lossy(body)));
        off = frame_end;
    }
    out
}

fn parse_stt(body: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for field in body.split('/') {
        if field.is_empty() {
            continue;
        }
        if let Some((k, v)) = field.split_once("@=") {
            map.insert(k.to_string(), v.replace("@S", "/").replace("@A", "@"));
        }
    }
    map
}

/// Douyu's danmaku color is an enum, not RGB. Standard community table.
fn douyu_color(col: &str) -> Option<String> {
    match col {
        "1" => Some("#ff0000"),
        "2" => Some("#1e87f0"),
        "3" => Some("#7ac84b"),
        "4" => Some("#ff7f00"),
        "5" => Some("#9b39f4"),
        "6" => Some("#ff69b4"),
        _ => None,
    }
    .map(str::to_string)
}

fn extract_chat(
    msg: &HashMap<String, String>,
) -> Option<(String, String, Option<String>, Option<i64>)> {
    if msg.get("type").map(String::as_str) != Some("chatmsg") {
        return None;
    }
    // Messages without `dms` are shadow-hidden by the official client.
    if !msg.contains_key("dms") {
        return None;
    }
    let user = msg.get("nn").cloned().unwrap_or_else(|| "unknown".to_string());
    let content = msg.get("txt").cloned().unwrap_or_default();
    if content.is_empty() {
        return None;
    }
    let color = msg.get("col").and_then(|c| douyu_color(c));
    let level = msg.get("level").and_then(|l| l.parse::<i64>().ok());
    Some((user, content, color, level))
}

async fn connect_once(room_id: &str, app: &AppHandle, shutdown: &mut mpsc::Receiver<()>) -> ConnOutcome {
    let request = match WS_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "douyu ws request build failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };
    let (ws_stream, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(x) => x,
        Err(e) => {
            tracing::warn!(error = %e, "douyu ws connect failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };
    let (mut write, mut read) = ws_stream.split();

    let login = encode_frame(&format!("type@=loginreq/roomid@={room_id}/"));
    if write.send(Message::Binary(login.into())).await.is_err() {
        return ConnOutcome::Disconnected { got_message: false };
    }
    // NOTE: `rid@=` (not `rid=`) — the join key follows the same STT k/v
    // format as every other field; a malformed key silently joins nothing.
    let join = encode_frame(&format!("type@=joingroup/rid@={room_id}/gid@=-9999/"));
    if write.send(Message::Binary(join.into())).await.is_err() {
        return ConnOutcome::Disconnected { got_message: false };
    }

    emit_status(app, PlatformId::Douyu, room_id, "connected");

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await; // first tick fires immediately — skip it
    let mut got_message = false;

    loop {
        tokio::select! {
            _ = shutdown.recv() => {
                return ConnOutcome::Stop;
            }
            _ = heartbeat.tick() => {
                let hb = encode_frame("type@=mrkl/");
                if write.send(Message::Binary(hb.into())).await.is_err() {
                    return ConnOutcome::Disconnected { got_message };
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        for frame in decode_frames(&data) {
                            if let Some((user, content, color, level)) = extract_chat(&frame) {
                                got_message = true;
                                emit_chat(
                                    app,
                                    PlatformId::Douyu,
                                    room_id,
                                    user,
                                    content,
                                    color,
                                    level,
                                );
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
    let mut backoff = 1u64;
    loop {
        match connect_once(&room_id, &app, &mut shutdown).await {
            ConnOutcome::Stop => {
                emit_status(&app, PlatformId::Douyu, &room_id, "closed");
                return;
            }
            ConnOutcome::Disconnected { got_message } => {
                // A session that delivered messages is a healthy link — reset
                // backoff. One that never did may be a zombie endpoint.
                if got_message {
                    backoff = 1;
                }
                emit_status(&app, PlatformId::Douyu, &room_id, "reconnecting");
                let sleep = tokio::time::sleep(Duration::from_secs(backoff));
                tokio::select! {
                    _ = sleep => {}
                    _ = shutdown.recv() => {
                        emit_status(&app, PlatformId::Douyu, &room_id, "closed");
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

    /// Live-network probe (ignored by default): verifies WS connect, login,
    /// join, heartbeat, and that chat messages actually arrive.
    /// Run: DOUYU_PROBE_ROOM=9999 cargo test --lib -- --ignored probe_douyu --nocapture
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "requires live network access"]
    async fn probe_douyu_danmaku_live() {
        let room_id =
            std::env::var("DOUYU_PROBE_ROOM").unwrap_or_else(|_| "9999".to_string());

        let request = WS_URL.into_client_request().expect("request build");
        // Note: the "binary" subprotocol must NOT be requested — douyu's
        // gateway never echoes it and tungstenite aborts the handshake.
        let (ws, _) =
            tokio_tungstenite::connect_async(request).await.expect("ws connect failed");
        let (mut write, mut read) = ws.split();
        write
            .send(Message::Binary(encode_frame(&format!("type@=loginreq/roomid@={room_id}/")).into()))
            .await
            .expect("login send failed");
        write
            .send(Message::Binary(encode_frame(&format!("type@=joingroup/rid@={room_id}/gid@=-9999/")).into()))
            .await
            .expect("join send failed");

        let started = Instant::now();
        let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
        let mut chat = 0usize;
        let mut other = 0usize;
        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    let _ = write.send(Message::Binary(encode_frame("type@=mrkl/").into())).await;
                }
                msg = tokio::time::timeout(Duration::from_secs(5), read.next()) => {
                    match msg {
                        Ok(Some(Ok(m))) => {
                            if let Message::Binary(data) = m {
                                for frame in decode_frames(&data) {
                                    if extract_chat(&frame).is_some() {
                                        chat += 1;
                                        println!("[probe] chat: {}: {}", frame.get("nn").cloned().unwrap_or_default(), frame.get("txt").cloned().unwrap_or_default());
                                    } else {
                                        other += 1;
                                        if other <= 5 {
                                            println!("[probe] other frame type={:?}", frame.get("type"));
                                        }
                                    }
                                }
                            }
                        }
                        Ok(Some(Err(e))) => panic!("ws error after {elapsed:?}: {e}", elapsed = started.elapsed()),
                        Ok(None) => panic!("connection closed after {elapsed:?} (chat={chat})", elapsed = started.elapsed()),
                        Err(_) => {} // read idle
                    }
                }
            }
            if chat >= 3 || started.elapsed() > Duration::from_secs(30) {
                break;
            }
        }
        println!("[probe] done: chat={chat} other={other}");
        assert!(chat >= 1, "no chat messages within 30s");
    }

    #[test]
    fn encode_frame_matches_douyu_layout() {
        // LE: len(u32) | len(u32) | 689(u16) | 0 | 0 | body | 0x00
        // len = body_bytes + 9 (excludes the first 4 length bytes)
        let frame = encode_frame("type@=mrkl/");
        let len = u32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
        assert_eq!(len + 4, frame.len());
        assert_eq!(
            u32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]),
            len as u32
        );
        assert_eq!(u16::from_le_bytes([frame[8], frame[9]]), 689);
        assert_eq!(frame[10], 0u8);
        assert_eq!(frame[11], 0u8);
        assert_eq!(&frame[12..frame.len() - 1], b"type@=mrkl/");
        assert_eq!(frame[frame.len() - 1], 0u8);
    }

    #[test]
    fn decode_multiple_frames_in_one_ws_message() {
        let mut buf = encode_frame("type@=chatmsg/nn@=Alice/txt@=hello/col@=1/dms@=1/");
        buf.extend_from_slice(&encode_frame("type@=chatmsg/nn@=Bob/txt@=world/col@=2/dms@=1/"));
        let msgs = decode_frames(&buf);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].get("nn").map(String::as_str), Some("Alice"));
        assert_eq!(msgs[1].get("txt").map(String::as_str), Some("world"));
    }

    #[test]
    fn stt_unescapes_slashes_and_ats() {
        let frame = encode_frame("type@=chatmsg/nn@=A/txt@=a@Sb@Ac/col@=/dms@=1/");
        let msgs = decode_frames(&frame);
        assert_eq!(msgs[0].get("txt").map(String::as_str), Some("a/b@c"));
    }

    #[test]
    fn hidden_danmaku_without_dms_is_dropped() {
        // Messages missing the `dms` field are shadow-hidden by the official
        // client ("阴间弹幕") — drop them like dart_simple_live does.
        let frame = encode_frame("type@=chatmsg/nn@=Ghost/txt@=boo/");
        let msgs = decode_frames(&frame);
        assert!(extract_chat(&msgs[0]).is_none());
    }

    #[test]
    fn color_enum_maps_to_hex() {
        assert_eq!(douyu_color("1"), Some("#ff0000".to_string()));
        assert_eq!(douyu_color("6"), Some("#ff69b4".to_string()));
        assert_eq!(douyu_color("0"), None);
        assert_eq!(douyu_color("x"), None);
    }

    #[test]
    fn truncated_tail_is_dropped() {
        let mut buf = encode_frame("type@=chatmsg/nn@=Alice/txt@=hello/col@=1/dms@=1/");
        let mut partial = encode_frame("type@=chatmsg/nn@=Bob/");
        partial.truncate(8);
        buf.extend_from_slice(&partial);
        let msgs = decode_frames(&buf);
        assert_eq!(msgs.len(), 1);
    }
}
