mod models;
mod platforms;
mod proxy;

use models::{
    AppPreferences, Appearance, PlatformId, ProxyMode, RoomCard, RoomDetail, SearchResult,
    StreamSource,
};

#[tauri::command]
async fn get_featured(platform: PlatformId) -> Result<Vec<RoomCard>, String> {
    match platform {
        PlatformId::Bilibili => platforms::bilibili::get_featured().await,
        PlatformId::Douyu => platforms::douyu::get_featured().await,
    }
}

#[tauri::command]
async fn search_rooms(
    keyword: String,
    platform: Option<PlatformId>,
) -> Result<SearchResult, String> {
    let items = match platform {
        Some(PlatformId::Bilibili) => platforms::bilibili::search_rooms(&keyword).await?,
        Some(PlatformId::Douyu) => platforms::douyu::search_rooms(&keyword).await?,
        None => {
            let mut merged = Vec::new();
            if let Ok(mut items) = platforms::bilibili::search_rooms(&keyword).await {
                merged.append(&mut items);
            }
            if let Ok(mut items) = platforms::douyu::search_rooms(&keyword).await {
                merged.append(&mut items);
            }
            merged
        }
    };

    Ok(SearchResult {
        keyword,
        total: Some(items.len() as u64),
        items,
    })
}

#[tauri::command]
async fn get_room_detail(
    platform: PlatformId,
    room_id: String,
) -> Result<RoomDetail, String> {
    match platform {
        PlatformId::Bilibili => platforms::bilibili::get_room_detail(&room_id).await,
        PlatformId::Douyu => platforms::douyu::get_room_detail(&room_id).await,
    }
}

#[tauri::command]
async fn get_stream_sources(
    platform: PlatformId,
    room_id: String,
) -> Result<Vec<StreamSource>, String> {
    match platform {
        PlatformId::Bilibili => platforms::bilibili::get_stream_sources(&room_id).await,
        PlatformId::Douyu => platforms::douyu::get_stream_sources(&room_id).await,
    }
}

#[tauri::command]
fn load_preferences() -> AppPreferences {
    AppPreferences {
        default_platform: PlatformId::Bilibili,
        resume_last_session: true,
        appearance: Appearance::System,
        proxy: ProxyMode::None,
        last_visited: None,
    }
}

#[tauri::command]
fn save_preferences(preferences: AppPreferences) -> AppPreferences {
    // Immediately apply proxy mode so subsequent HTTP calls use the new setting.
    platforms::http::set_proxy_mode(preferences.proxy == ProxyMode::System);
    preferences
}

/// Called by the frontend on startup after reading saved preferences from the
/// local store, ensuring the Rust HTTP layer matches the persisted proxy mode
/// without waiting for the next save.
#[tauri::command]
fn apply_proxy_mode(system: bool) {
    platforms::http::set_proxy_mode(system);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Start the local image-proxy server before the first window opens.
            // This ensures Bilibili CDN images load correctly by injecting the
            // proper Referer/Origin headers (avoids hdslb.com 403).
            proxy::start();
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_featured,
            search_rooms,
            get_room_detail,
            get_stream_sources,
            load_preferences,
            save_preferences,
            apply_proxy_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
