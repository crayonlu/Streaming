// Auto-extracts Bilibili cookies (SESSDATA, bili_jct) from the app's WebView.
// On Windows this reads from the embedded WebView2 store; on macOS it uses
// the WKWebView cookie store via the same API surface.

use ::cookie::Cookie;
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl};

/// Result of a cookie collection attempt.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliCookieResult {
    /// Full cookie string suitable for the Cookie header (semicolon-joined).
    pub cookie: Option<String>,
    /// Whether the cookie jar contained a non-empty SESSDATA value.
    pub has_sessdata: bool,
    /// Whether the cookie jar contained a non-empty bili_jct value.
    pub has_bili_jct: bool,
}

/// Extracts SESSDATA / bili_jct from every open WebView window and merges them
/// into a single header-ready string.
pub async fn get_bilibili_cookie(app_handle: &AppHandle) -> BilibiliCookieResult {
    let url = "https://www.bilibili.com/";

    // Collect from all existing windows first (avoids creating a new webview if
    // the user already has a Bilibili tab open inside the app).
    let from_existing = collect_from_labels(app_handle, webview_labels(app_handle), url).await;

    // If no SESSDATA found, bootstrap a hidden webview so we capture the cookie
    // even when the user hasn't visited Bilibili in any window yet.
    if !from_existing.has_sessdata {
        let from_bootstrap = bootstrap_and_collect(app_handle, url).await;
        return merge_results(&from_existing, &from_bootstrap);
    }

    from_existing
}

// ── Private helpers ────────────────────────────────────────────────────────────

fn webview_labels(app_handle: &AppHandle) -> Vec<String> {
    app_handle
        .webview_windows()
        .keys()
        .cloned()
        .collect()
}

fn merge_results(a: &BilibiliCookieResult, b: &BilibiliCookieResult) -> BilibiliCookieResult {
    let cookie = match (&a.cookie, &b.cookie) {
        (Some(a), Some(b)) => {
            // Merge both cookie maps so neither overwrites the other.
            let mut map = BTreeMap::new();
            for pair in a.split(';') {
                if let Some((k, v)) = pair.trim().split_once('=') {
                    map.insert(k.to_string(), v.to_string());
                }
            }
            for pair in b.split(';') {
                if let Some((k, v)) = pair.trim().split_once('=') {
                    map.insert(k.to_string(), v.to_string());
                }
            }
            Some(
                map.into_iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        }
        (a @ Some(_), None) => a.clone(),
        (None, b @ Some(_)) => b.clone(),
        (None, None) => None,
    };
    BilibiliCookieResult {
        cookie,
        has_sessdata: a.has_sessdata || b.has_sessdata,
        has_bili_jct: a.has_bili_jct || b.has_bili_jct,
    }
}

/// Opens a hidden WebView pointed at Bilibili, waits briefly for cookies to be
/// written, then reads the cookie jar and closes the window.
async fn bootstrap_and_collect(
    app_handle: &AppHandle,
    url: &str,
) -> BilibiliCookieResult {
    let label = "bilibili-silent-bootstrap".to_string();

    // Close any stale bootstrap window from a previous run.
    if let Some(old) = app_handle.get_webview_window(&label) {
        let _ = old.close();
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let parsed_url = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return BilibiliCookieResult::default(),
    };

    // Clone so we can pass into async blocks that require 'static.
    let handle = app_handle.clone();
    let label_owned = label.to_string();

    // Build a hidden, non-interactive bootstrap window.
    let builder = tauri::WebviewWindowBuilder::new(
        &handle,
        &label_owned,
        WebviewUrl::External(parsed_url),
    )
    .visible(false)
    .resizable(false)
    .focused(false);

    if builder.build().is_err() {
        return BilibiliCookieResult::default();
    }

    // Give the page ~3 seconds to run its cookie-setting scripts.
    tokio::time::sleep(Duration::from_secs(3)).await;

    let result = collect_from_labels(&handle, vec![label_owned.clone()], url).await;

    // Clean up the bootstrap window.
    if let Some(w) = handle.get_webview_window(&label_owned) {
        let _ = w.close();
    }

    result
}

/// Iterates over the requested window labels and reads Bilibili-relevant cookies
/// from each one, merging them into a single BilibiliCookieResult.
async fn collect_from_labels(
    app_handle: &AppHandle,
    labels: Vec<String>,
    url: &str,
) -> BilibiliCookieResult {
    let url = url.to_string();
    let handle = app_handle.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut collected: BTreeMap<String, String> = BTreeMap::new();
        let mut has_sessdata = false;
        let mut has_bili_jct = false;

        let parsed_url = match url::Url::parse(&url) {
            Ok(u) => u,
            Err(_) => return BilibiliCookieResult::default(),
        };

        for label in labels {
            let Some(window) = handle.get_webview_window(&label) else {
                continue;
            };

            // Try the URL-scoped read first (works on all platforms).
            if let Ok(cookies) = window.cookies_for_url(parsed_url.clone()) {
                let (s, j) = merge_cookies(&mut collected, cookies);
                has_sessdata |= s;
                has_bili_jct |= j;
            }

            // On some builds / platforms a second call without URL gives all cookies.
            // Call it only if the URL-scoped one didn't find anything — it is
            // safe to do so because it is read-only and the worst outcome is a
            // duplicate entry that gets deduplicated by the BTreeMap.
            if !has_sessdata {
                if let Ok(cookies) = window.cookies() {
                    let (s, j) = merge_cookies(&mut collected, cookies);
                    has_sessdata |= s;
                    has_bili_jct |= j;
                }
            }
        }

        let cookie = if collected.is_empty() {
            None
        } else {
            Some(
                collected
                    .into_iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        };

        BilibiliCookieResult {
            cookie,
            has_sessdata,
            has_bili_jct,
        }
    })
    .await
    .unwrap_or_default()
}

/// Merges a slice of cookies into the accumulator map and returns whether
/// SESSDATA / bili_jct were found.
fn merge_cookies(
    acc: &mut BTreeMap<String, String>,
    cookies: Vec<Cookie<'static>>,
) -> (bool, bool) {
    let mut has_sessdata = false;
    let mut has_bili_jct = false;

    for c in cookies {
        let name = c.name().to_string();
        let domain = c.domain().map(|d| d.to_string());

        // Only keep cookies from bilibili.com or from the bare name (session cookies
        // that the site sets without an explicit domain).
        let is_bilibili = domain
            .as_ref()
            .map(|d| d.contains("bilibili.com"))
            .unwrap_or_else(|| name.eq_ignore_ascii_case("SESSDATA")
                || name.eq_ignore_ascii_case("bili_jct")
                || name.eq_ignore_ascii_case("DedeUserID")
                || name.eq_ignore_ascii_case("b_lsid"));

        if !is_bilibili {
            continue;
        }

        let value = c.value().to_string();
        if name.eq_ignore_ascii_case("SESSDATA") && !value.is_empty() {
            has_sessdata = true;
        }
        if name.eq_ignore_ascii_case("bili_jct") && !value.is_empty() {
            has_bili_jct = true;
        }

        // BTreeMap deduplicates by key, so the first occurrence wins — which is
        // fine because the accumulated map is built from all windows in the same
        // order and we prefer the first (most authoritative) value.
        acc.entry(name).or_insert(value);
    }

    (has_sessdata, has_bili_jct)
}

/// Opens a visible login window for Bilibili at passport.bilibili.com.
/// The frontend polls get_bilibili_cookie until login is detected, then closes the window.
pub async fn open_bilibili_login_window(app_handle: &AppHandle) -> Result<String, String> {
    let label = "bilibili-login-window";

    // Close any existing login window first.
    if let Some(old) = app_handle.get_webview_window(label) {
        let _ = old.close();
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    let login_url = "https://passport.bilibili.com/login";
    let parsed_url =
        url::Url::parse(login_url).map_err(|e| format!("invalid login URL: {e}"))?;

    let handle = app_handle.clone();
    let label_owned = label.to_string();

    tauri::WebviewWindowBuilder::new(&handle, &label_owned, WebviewUrl::External(parsed_url))
        .title("B站登录")
        .inner_size(420.0, 640.0)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| format!("failed to open login window: {e}"))?;

    Ok(label_owned)
}

/// Closes the visible login window if it exists.
pub async fn close_bilibili_login_window(app_handle: &AppHandle) {
    let label = "bilibili-login-window";
    if let Some(w) = app_handle.get_webview_window(label) {
        let _ = w.close();
    }
}
