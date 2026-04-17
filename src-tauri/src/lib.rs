mod models;
mod platforms;
mod proxy;

use models::{
    AppPreferences, Appearance, PlatformId, ProxyMode, ReplayItem, ReplayQuality, RoomCard,
    RoomDetail, SearchResult, StreamSource,
};
use tauri::AppHandle;

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
) -> Result<SearchResult, String> {
    let items = match platform {
        Some(PlatformId::Bilibili) => platforms::bilibili::search_rooms(&keyword).await?,
        Some(PlatformId::Douyu) => platforms::douyu::search_rooms(&keyword).await?,
        None => {
            let bili_result = platforms::bilibili::search_rooms(&keyword).await;
            let douyu_result = platforms::douyu::search_rooms(&keyword).await;

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
        PlatformId::Bilibili => platforms::bilibili::get_stream_sources(&app_handle, &room_id).await,
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
        PlatformId::Douyu => {
            platforms::douyu::get_replay_parts(&room_id, &hash_id, &up_id).await
        }
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
async fn get_bilibili_cookie(
    app_handle: AppHandle,
) -> platforms::bilibili::BilibiliCookieResult {
    platforms::bilibili::cookie::get_bilibili_cookie(&app_handle).await
}

/// Opens a visible login window at passport.bilibili.com. The frontend polls
/// get_bilibili_cookie until login is detected, then closes the window.
#[tauri::command]
async fn open_bilibili_login_window(
    app_handle: AppHandle,
) -> Result<String, String> {
    platforms::bilibili::cookie::open_bilibili_login_window(&app_handle).await
}

/// Closes the visible login window if it is still open.
#[tauri::command]
async fn close_bilibili_login_window(app_handle: AppHandle) {
    platforms::bilibili::cookie::close_bilibili_login_window(&app_handle).await
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
            get_replay_list,
            get_replay_parts,
            get_replay_qualities,
            load_preferences,
            save_preferences,
            apply_proxy_mode,
            set_bilibili_sessdata,
            get_bilibili_cookie,
            open_bilibili_login_window,
            close_bilibili_login_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
