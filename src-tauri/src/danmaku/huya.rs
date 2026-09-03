//! Huya danmaku client — Tars/JCE binary protocol over
//! wss://cdnws.api.huya.com.
//!
//!   Register: WSCommand{iCmdType=16, vData=bytes(WSRegisterReq)}
//!     where the inner body is list<string>["live:{ayyuid}", "chat:{ayyuid}"]
//!     followed by an empty string field.
//!   Heartbeat: a fixed OnUserHeartBeat packet every 20s (captured packet
//!     layout verified in production by DTV; send verbatim).
//!   Push: WSPushMessage{iCmdType=7, vData=bytes(HYPushMessage)} where
//!     HYPushMessage.uri == 1400 carries chat (MessageNotice: user struct
//!     at 0, text at 3, bulletFormat struct at 6).

use futures::{SinkExt, StreamExt};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use super::{emit_chat, emit_status, ConnOutcome};
use crate::models::PlatformId;
use crate::platforms::huya::jce::{JceDecoder, JceEncoder};
use crate::platforms::huya::stream_url::fetch_huya_ids;

const WS_URL: &str = "wss://cdnws.api.huya.com";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(20);

/// Captured OnUserHeartBeat request packet (production-proven by DTV).
/// The Tars payload inside is opaque; send verbatim.
const HEARTBEAT: &[u8] = b"\x00\x03\x1d\x00\x00\x69\x00\x00\x00\x69\x10\x03\x2c\x3c\x4c\x56\x08\x6f\x6e\x6c\x69\x6e\x65\x75\x69\x66\x0f\x4f\x6e\x55\x73\x65\x72\x48\x65\x61\x72\x74\x42\x65\x61\x74\x7d\x00\x00\x3c\x08\x00\x01\x06\x04\x74\x52\x65\x71\x1d\x00\x00\x2f\x0a\x0a\x0c\x16\x00\x26\x00\x36\x07\x61\x64\x72\x5f\x77\x61\x70\x46\x00\x0b\x12\x03\xae\xf0\x0f\x22\x03\xae\xf0\x0f\x3c\x42\x6d\x52\x02\x60\x5c\x60\x01\x7c\x82\x00\x0b\xb0\x1f\x9c\xac\x0b\x8c\x98\x0c\xa8\x0c";

/// Build the register packet: WSCommand{iCmdType=16, vData=bytes(topics)}.
fn build_register_packet(ayyuid: i64) -> Vec<u8> {
    let topics = vec![format!("live:{ayyuid}"), format!("chat:{ayyuid}")];

    let mut oos = JceEncoder::new();
    oos.write_string_list(0, &topics);
    oos.write_string(1, "");

    let mut wscmd = JceEncoder::new();
    wscmd.write_int32(0, 16);
    wscmd.write_bytes(1, &oos.to_bytes());
    wscmd.to_bytes()
}

/// Returns Some((nick, text, color_hex)) for chat pushes (uri 1400).
fn decode_msg(data: &[u8]) -> Result<Option<(String, String, Option<String>)>, String> {
    let mut d = JceDecoder::new(data);
    let top = d.read_int32(0, -1)?;
    if top != 7 {
        return Ok(None);
    }
    let Some(b1) = d.read_bytes(1)? else {
        return Ok(None);
    };

    let mut inner = JceDecoder::new(&b1);
    let uri = inner.read_int32(1, -1)?;
    let b2 = inner.read_bytes(2)?.unwrap_or_default();
    if uri != 1400 {
        return Ok(None);
    }

    let mut payload = JceDecoder::new(&b2);
    let mut nick = String::new();
    if payload.read_struct_begin(0)? {
        let _uid = payload.read_int64(0, -1)?;
        let _imid = payload.read_int64(1, -1)?;
        nick = payload.read_string(2, String::new())?;
        let _gender = payload.read_int32(3, -1)?;
        payload.read_struct_end()?;
    }
    let text = payload.read_string(3, String::new())?;
    if text.is_empty() {
        return Ok(None);
    }

    let mut color = None;
    if payload.read_struct_begin(6)? {
        let c = payload.read_int32(0, 16_777_215)?;
        payload.read_struct_end()?;
        if c > 0 && c <= 0xFF_FFFF {
            color = Some(format!("#{c:06x}"));
        }
    }

    let nick = if nick.is_empty() { "匿名".to_string() } else { nick };
    Ok(Some((nick, text, color)))
}

async fn connect_once(room_id: &str, app: &AppHandle, shutdown: &mut mpsc::Receiver<()>) -> ConnOutcome {
    let (ayyuid, _top_sid) = match fetch_huya_ids(room_id).await {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(error = %e, "huya danmaku id fetch failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };
    let reg = build_register_packet(ayyuid);

    let (ws_stream, _) = match tokio_tungstenite::connect_async(WS_URL).await {
        Ok(x) => x,
        Err(e) => {
            tracing::warn!(error = %e, "huya ws connect failed");
            return ConnOutcome::Disconnected { got_message: false };
        }
    };
    let (mut write, mut read) = ws_stream.split();

    if write.send(WsMessage::Binary(reg.into())).await.is_err() {
        return ConnOutcome::Disconnected { got_message: false };
    }
    emit_status(app, PlatformId::Huya, room_id, "connected");

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await;
    let mut got_message = false;

    loop {
        tokio::select! {
            _ = shutdown.recv() => return ConnOutcome::Stop,
            _ = heartbeat.tick() => {
                if write
                    .send(WsMessage::Binary(HEARTBEAT.to_vec().into()))
                    .await
                    .is_err()
                {
                    return ConnOutcome::Disconnected { got_message };
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(WsMessage::Binary(data))) => {
                        match decode_msg(&data) {
                            Ok(Some((nick, text, color))) => {
                                got_message = true;
                                emit_chat(app, PlatformId::Huya, room_id, nick, text, color, None);
                            }
                            Ok(None) => {}
                            Err(e) => {
                                tracing::debug!(error = %e, "huya danmaku decode failed");
                            }
                        }
                    }
                    Some(Ok(WsMessage::Close(_))) | Some(Err(_)) | None => {
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
                emit_status(&app, PlatformId::Huya, &room_id, "closed");
                return;
            }
            ConnOutcome::Disconnected { got_message } => {
                if got_message {
                    backoff = 1;
                }
                emit_status(&app, PlatformId::Huya, &room_id, "reconnecting");
                let sleep = tokio::time::sleep(Duration::from_secs(backoff));
                tokio::select! {
                    _ = sleep => {}
                    _ = shutdown.recv() => {
                        emit_status(&app, PlatformId::Huya, &room_id, "closed");
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

    fn build_fake_chat(nick: &str, text: &str, color: i32) -> Vec<u8> {
        // HuyaUser struct: 0 uid, 2 name
        let mut user = JceEncoder::new();
        user.write_int64(0, 1001);
        user.write_string(2, nick);

        // HuyaDanmakuFmt struct: 0 color
        let mut fmt = JceEncoder::new();
        fmt.write_int32(0, color);

        // MessageNotice: user(0) / text(3) / fmt(6)
        let mut payload = JceEncoder::new();
        payload.write_struct_raw(0, &user.to_bytes());
        payload.write_string(3, text);
        payload.write_struct_raw(6, &fmt.to_bytes());

        // HYPushMessage: uri(1) = 1400, payload bytes(2)
        let mut inner = JceEncoder::new();
        inner.write_int32(1, 1400);
        inner.write_bytes(2, &payload.to_bytes());

        // WSPushMessage: type(0) = 7, bytes(1)
        let mut outer = JceEncoder::new();
        outer.write_int32(0, 7);
        outer.write_bytes(1, &inner.to_bytes());
        outer.to_bytes()
    }

    #[test]
    fn decodes_chat_message_1400() {
        let data = build_fake_chat("小明", "666", 0xff0000);
        let msg = decode_msg(&data).expect("decode").expect("is chat");
        assert_eq!(msg.0, "小明");
        assert_eq!(msg.1, "666");
        assert_eq!(msg.2, Some("#ff0000".to_string()));
    }

    #[test]
    fn white_and_invalid_colors_fall_back_to_none() {
        let data = build_fake_chat("A", "hi", 0);
        let msg = decode_msg(&data).unwrap().unwrap();
        assert_eq!(msg.2, None);

        let data = build_fake_chat("A", "hi", -5);
        let msg = decode_msg(&data).unwrap().unwrap();
        assert_eq!(msg.2, None);
    }

    #[test]
    fn ignores_non_chat_uri() {
        let mut inner = JceEncoder::new();
        inner.write_int32(1, 8006); // online count — not implemented
        inner.write_bytes(2, &[]);
        let mut outer = JceEncoder::new();
        outer.write_int32(0, 7);
        outer.write_bytes(1, &inner.to_bytes());
        assert!(decode_msg(&outer.to_bytes()).unwrap().is_none());
    }

    #[test]
    fn ignores_non_push_packets() {
        let mut outer = JceEncoder::new();
        outer.write_int32(0, 1); // not 7
        assert!(decode_msg(&outer.to_bytes()).unwrap().is_none());
    }

    #[test]
    fn empty_text_is_dropped() {
        let data = build_fake_chat("A", "", 0xffffff);
        assert!(decode_msg(&data).unwrap().is_none());
    }

    #[test]
    fn register_packet_round_trip() {
        let packet = build_register_packet(123456);
        let mut d = JceDecoder::new(&packet);
        assert_eq!(d.read_int32(0, -1).unwrap(), 16);
        let inner = d.read_bytes(1).unwrap().unwrap();

        // Inner body = list<string>["live:…", "chat:…"] + empty string field,
        // byte-identical to the canonical encoder output.
        let mut expect = JceEncoder::new();
        expect.write_string_list(0, &["live:123456".to_string(), "chat:123456".to_string()]);
        expect.write_string(1, "");
        assert_eq!(inner, expect.to_bytes());
    }
}
