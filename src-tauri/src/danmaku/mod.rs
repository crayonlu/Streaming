//! Live danmaku (bullet chat) subsystem.
//!
//! Protocol layer lives in Rust because browser WebSocket cannot set custom
//! headers (Bilibili requires Cookie; handshake headers matter for Huya).
//! Each platform client normalizes messages into `DanmakuEvent` and pushes
//! them to the frontend via a single Tauri channel: `danmaku-event`.

pub mod douyu;
mod types;

pub use types::DanmakuEvent;

use crate::models::PlatformId;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

pub const DANMAKU_CHANNEL: &str = "danmaku-event";

/// Shutdown channels for running listeners, keyed by "platform:roomId".
/// Starting a listener for an already-watched room replaces the old one.
#[derive(Default)]
pub struct DanmakuRegistry(pub Mutex<HashMap<String, mpsc::Sender<()>>>);

fn registry_key(platform: &PlatformId, room_id: &str) -> String {
    let p = match platform {
        PlatformId::Bilibili => "bilibili",
        PlatformId::Douyu => "douyu",
        PlatformId::Huya => "huya",
    };
    format!("{p}:{room_id}")
}

pub fn emit(app: &AppHandle, ev: DanmakuEvent) {
    if let Err(e) = app.emit(DANMAKU_CHANNEL, ev) {
        tracing::warn!(error = %e, "danmaku emit failed");
    }
}

pub fn emit_chat(
    app: &AppHandle,
    platform: PlatformId,
    room_id: &str,
    user: String,
    content: String,
    color: Option<String>,
    user_level: Option<i64>,
) {
    emit(
        app,
        DanmakuEvent {
            kind: "chat".to_string(),
            platform,
            room_id: room_id.to_string(),
            user: Some(user),
            content: Some(content),
            color,
            user_level,
            count: None,
            state: None,
        },
    );
}

pub fn emit_online(app: &AppHandle, platform: PlatformId, room_id: &str, count: i64) {
    emit(
        app,
        DanmakuEvent {
            kind: "online".to_string(),
            platform,
            room_id: room_id.to_string(),
            user: None,
            content: None,
            color: None,
            user_level: None,
            count: Some(count),
            state: None,
        },
    );
}

/// state: "connected" | "reconnecting" | "closed"
pub fn emit_status(app: &AppHandle, platform: PlatformId, room_id: &str, state: &str) {
    emit(
        app,
        DanmakuEvent {
            kind: "status".to_string(),
            platform,
            room_id: room_id.to_string(),
            user: None,
            content: None,
            color: None,
            user_level: None,
            count: None,
            state: Some(state.to_string()),
        },
    );
}

/// Shared outcome for one connection attempt.
pub enum ConnOutcome {
    /// Frontend asked us to stop — no reconnect.
    Stop,
    /// Connection dropped. `got_message` tracks whether this session ever
    /// received data; reconnect backoff only resets when it did (guards
    /// against "TCP up but server never pushes" zombie connections).
    Disconnected { got_message: bool },
}

#[tauri::command]
pub async fn start_danmaku(
    platform: PlatformId,
    room_id: String,
    app: AppHandle,
    registry: tauri::State<'_, DanmakuRegistry>,
) -> Result<(), String> {
    let key = registry_key(&platform, &room_id);

    // Replace any existing listener for the same room.
    let previous = {
        let mut lock = registry.0.lock().map_err(|e| e.to_string())?;
        lock.remove(&key)
    };
    if let Some(tx) = previous {
        let _ = tx.send(()).await;
    }

    let (tx, rx) = mpsc::channel::<()>(1);
    {
        let mut lock = registry.0.lock().map_err(|e| e.to_string())?;
        lock.insert(key.clone(), tx);
    }

    let app_clone = app.clone();
    let room = room_id.clone();
    match platform {
        PlatformId::Douyu => {
            tokio::spawn(async move { douyu::run(room, app_clone, rx).await });
        }
        PlatformId::Bilibili | PlatformId::Huya => {
            // Task 9 / Task 10 wire these in.
            return Err("该平台弹幕尚未实现".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_danmaku(
    platform: PlatformId,
    room_id: String,
    registry: tauri::State<'_, DanmakuRegistry>,
) -> Result<(), String> {
    let key = registry_key(&platform, &room_id);
    let tx = {
        let mut lock = registry.0.lock().map_err(|e| e.to_string())?;
        lock.remove(&key)
    };
    if let Some(tx) = tx {
        let _ = tx.send(()).await;
    }
    Ok(())
}
