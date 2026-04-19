//! Bilibili cookie persistence helpers.
//!
//! Bilibili's official replay APIs are not exposed as a normal viewer feature:
//! reading another anchor's replay list requires that anchor to grant clip
//! permissions. The app therefore does not implement Bilibili replay playback.
//! This module is kept only because Bilibili live playback can still benefit
//! from a persisted Cookie for higher-quality stream URLs.

fn cookie_value(cookie: &str, key: &str) -> Option<String> {
    cookie
        .split(';')
        .filter_map(|chunk| {
            let trimmed = chunk.trim();
            let (name, value) = trimmed.split_once('=')?;
            Some((name.trim(), value.trim()))
        })
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_cookie_input(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains('=') {
        Some(trimmed.to_string())
    } else {
        Some(format!("SESSDATA={trimmed}"))
    }
}

/// Persists a Bilibili cookie header to a local file so it survives restarts.
/// Accepts either a raw SESSDATA value or a complete Cookie header.
pub(crate) async fn save_bilibili_sessdata(sessdata: &str) {
    let Some(cookie) = normalize_cookie_input(sessdata) else {
        return;
    };
    let map = serde_json::json!({
        "cookie": cookie,
        "SESSDATA": cookie_value(&cookie, "SESSDATA"),
        "bili_jct": cookie_value(&cookie, "bili_jct"),
    });
    let _ = tokio::fs::write(".bilibili_cookie_store.json", map.to_string()).await;
}

/// Reads a Cookie header from the on-disk cookie store. Returns None if absent or invalid.
pub(crate) async fn read_saved_cookie() -> Option<String> {
    let content = tokio::fs::read(".bilibili_cookie_store.json").await.ok()?;
    let map: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&content).ok()?;
    if let Some(cookie) = map
        .get("cookie")
        .and_then(|v| v.as_str())
        .and_then(normalize_cookie_input)
    {
        return Some(cookie);
    }
    let sessdata = map.get("SESSDATA")?.as_str()?.trim();
    normalize_cookie_input(sessdata)
}

/// Public wrapper called by the `set_bilibili_sessdata` command.
pub async fn persist_sessdata(sessdata: &str) {
    save_bilibili_sessdata(sessdata).await;
}
