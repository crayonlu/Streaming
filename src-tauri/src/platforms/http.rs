use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;

const CONNECT_TIMEOUT_SECS: u64 = 5;
const REQUEST_TIMEOUT_SECS: u64 = 12;

/// When true, use OS/env proxy; when false, disable all proxy.
static USE_SYSTEM_PROXY: AtomicBool = AtomicBool::new(false);

/// Apply the user's proxy preference.  
/// Called from `save_preferences` and on startup after loading stored prefs.
pub fn set_proxy_mode(system: bool) {
    USE_SYSTEM_PROXY.store(system, Ordering::Relaxed);
}

fn build_no_proxy_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .no_proxy()
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn build_sys_proxy_client() -> Client {
    // No .no_proxy() → reqwest reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars
    // and on Windows also the registry via the WinHTTP/WinInet layer.
    Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| Client::new())
}

/// Shared reqwest client selected by the current proxy mode.
/// The two underlying clients are lazily initialized and cached.
pub fn shared_client() -> &'static Client {
    static NO_PROXY: OnceLock<Client> = OnceLock::new();
    static SYS_PROXY: OnceLock<Client> = OnceLock::new();

    if USE_SYSTEM_PROXY.load(Ordering::Relaxed) {
        SYS_PROXY.get_or_init(build_sys_proxy_client)
    } else {
        NO_PROXY.get_or_init(build_no_proxy_client)
    }
}

/// Alternate builder when a caller needs custom headers or redirect policy.
/// Respects the current proxy mode.
pub fn custom_client_builder() -> reqwest::ClientBuilder {
    let b = Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));
    if USE_SYSTEM_PROXY.load(Ordering::Relaxed) {
        b
    } else {
        b.no_proxy()
    }
}

/// Run an async operation with bounded retry.
/// - `attempts` is the total number of tries (so 3 = 1 original + 2 retries).
/// - backoff grows linearly starting at 250ms.
pub async fn retry<T, E, F, Fut>(attempts: u32, mut op: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let total = attempts.max(1);
    let mut last_err: Option<E> = None;
    for i in 0..total {
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = Some(e);
                if i + 1 < total {
                    let delay = Duration::from_millis(250 * u64::from(i + 1));
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
    Err(last_err.expect("retry reached end without error"))
}
