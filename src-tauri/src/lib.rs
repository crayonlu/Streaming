mod models;
mod platforms;
mod proxy;

use models::{
    AppPreferences, PlatformId, ProxyMode, ReplayItem, ReplayQuality, RoomCard, RoomDetail,
    SearchResult, StreamSource,
};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

#[tauri::command]
async fn get_featured(platform: PlatformId, page: Option<u32>) -> Result<Vec<RoomCard>, String> {
    let p = page.unwrap_or(1);
    match platform {
        PlatformId::Bilibili => platforms::bilibili::get_featured(p).await,
        PlatformId::Douyu => platforms::douyu::get_featured(p).await,
    }
}

#[tauri::command]
async fn search_rooms(
    keyword: String,
    platform: Option<PlatformId>,
    page: Option<u32>,
) -> Result<SearchResult, String> {
    let p = page.unwrap_or(1);
    let items = match platform {
        Some(PlatformId::Bilibili) => platforms::bilibili::search_rooms(&keyword, p).await?,
        Some(PlatformId::Douyu) => platforms::douyu::search_rooms(&keyword, p).await?,
        None => {
            let bili_result = platforms::bilibili::search_rooms(&keyword, p).await;
            let douyu_result = platforms::douyu::search_rooms(&keyword, p).await;

            let mut merged = Vec::new();
            let mut errors: Vec<String> = Vec::new();

            match bili_result {
                Ok(mut items) => merged.append(&mut items),
                Err(e) => errors.push(format!("B站: {e}")),
            }
            match douyu_result {
                Ok(mut items) => merged.append(&mut items),
                Err(e) => errors.push(format!("斗鱼: {e}")),
            }

            // If both platforms fail and no results were collected, surface the error.
            if merged.is_empty() && !errors.is_empty() {
                return Err(errors.join(" | "));
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
    app_handle: AppHandle,
) -> Result<RoomDetail, String> {
    match platform {
        PlatformId::Bilibili => platforms::bilibili::get_room_detail(&app_handle, &room_id).await,
        PlatformId::Douyu => platforms::douyu::get_room_detail(&room_id).await,
    }
}

#[tauri::command]
async fn get_stream_sources(
    platform: PlatformId,
    room_id: String,
    app_handle: AppHandle,
) -> Result<Vec<StreamSource>, String> {
    match platform {
        PlatformId::Bilibili => {
            platforms::bilibili::get_stream_sources(&app_handle, &room_id).await
        }
        PlatformId::Douyu => platforms::douyu::get_stream_sources(&room_id).await,
    }
}

#[tauri::command]
async fn get_replay_list(
    platform: PlatformId,
    room_id: String,
    page: Option<u32>,
    app_handle: AppHandle,
) -> Result<Vec<ReplayItem>, String> {
    let p = page.unwrap_or(1);
    match platform {
        PlatformId::Douyu => platforms::douyu::get_replay_list(&room_id, p).await,
        PlatformId::Bilibili => {
            platforms::bilibili::get_replay_list(&app_handle, &room_id, p).await
        }
    }
}

#[tauri::command]
async fn get_replay_parts(
    platform: PlatformId,
    room_id: String,
    hash_id: String,
    up_id: String,
) -> Result<Vec<ReplayItem>, String> {
    match platform {
        PlatformId::Douyu => platforms::douyu::get_replay_parts(&room_id, &hash_id, &up_id).await,
        PlatformId::Bilibili => {
            platforms::bilibili::get_replay_parts(&room_id, &hash_id, &up_id).await
        }
    }
}

#[tauri::command]
async fn get_replay_qualities(
    platform: PlatformId,
    replay_id: String,
    app_handle: AppHandle,
) -> Result<Vec<ReplayQuality>, String> {
    match platform {
        PlatformId::Douyu => platforms::douyu::get_replay_qualities(&replay_id).await,
        PlatformId::Bilibili => {
            platforms::bilibili::get_replay_qualities(&app_handle, &replay_id).await
        }
    }
}

#[tauri::command]
async fn set_bilibili_sessdata(sessdata: String) -> Result<(), String> {
    platforms::bilibili::persist_sessdata(&sessdata).await;
    Ok(())
}

/// Reads cookies from the app WebView (all open windows + a hidden bootstrap window).
/// Returns the merged cookie string and whether SESSDATA / bili_jct were found.
#[tauri::command]
async fn get_bilibili_cookie(app_handle: AppHandle) -> platforms::bilibili::BilibiliCookieResult {
    platforms::bilibili::cookie::get_bilibili_cookie(&app_handle).await
}

/// Opens a visible login window at passport.bilibili.com. The frontend polls
/// get_bilibili_cookie until login is detected, then closes the window.
#[tauri::command]
async fn open_bilibili_login_window(app_handle: AppHandle) -> Result<String, String> {
    platforms::bilibili::cookie::open_bilibili_login_window(&app_handle).await
}

/// Closes the visible login window if it is still open.
#[tauri::command]
async fn close_bilibili_login_window(app_handle: AppHandle) {
    platforms::bilibili::cookie::close_bilibili_login_window(&app_handle).await
}

const STORE_FILE: &str = "preferences.json";
const STORE_KEY: &str = "app_preferences";

#[tauri::command]
async fn load_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("failed to open store: {e}"))?;
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("failed to deserialize preferences: {e}")),
        None => Ok(AppPreferences::default()),
    }
}

#[tauri::command]
async fn save_preferences(
    app: AppHandle,
    preferences: AppPreferences,
) -> Result<AppPreferences, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("failed to open store: {e}"))?;
    let value = serde_json::to_value(&preferences)
        .map_err(|e| format!("failed to serialize preferences: {e}"))?;
    store.set(STORE_KEY, value);
    store
        .save()
        .map_err(|e| format!("failed to persist preferences: {e}"))?;

    // Apply proxy mode immediately so subsequent HTTP calls use the new setting.
    platforms::http::set_proxy_mode(preferences.proxy == ProxyMode::System);
    Ok(preferences)
}

/// Called by the frontend on startup after reading saved preferences from the
/// local store, ensuring the Rust HTTP layer matches the persisted proxy mode
/// without waiting for the next save.
#[tauri::command]
fn apply_proxy_mode(system: bool) {
    platforms::http::set_proxy_mode(system);
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomStatusEntry {
    platform: PlatformId,
    room_id: String,
}

#[tauri::command]
async fn check_rooms_live_status(
    rooms: Vec<RoomStatusEntry>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    let mut bili_ids = Vec::new();
    let mut douyu_ids = Vec::new();

    for entry in &rooms {
        match entry.platform {
            PlatformId::Bilibili => bili_ids.push(entry.room_id.clone()),
            PlatformId::Douyu => douyu_ids.push(entry.room_id.clone()),
        }
    }

    let mut result = std::collections::HashMap::new();

    let bili_map = platforms::bilibili::check_rooms_live(&bili_ids).await;
    result.extend(bili_map);

    let douyu_map = platforms::douyu::check_rooms_live(&douyu_ids).await;
    result.extend(douyu_map);

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "streaming=info".parse().unwrap()),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        .setup(|_app| {
            tracing::info!("starting image proxy");
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
            get_replay_list,
            get_replay_parts,
            get_replay_qualities,
            load_preferences,
            save_preferences,
            apply_proxy_mode,
            set_bilibili_sessdata,
            get_bilibili_cookie,
            open_bilibili_login_window,
            close_bilibili_login_window,
            check_rooms_live_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
