//! Local HTTP proxy for Bilibili CDN resources.
//!
//! Bilibili's CDN rejects requests that carry wrong `Origin`/`Referer` headers.
//! WebView2 sends `Origin: tauri://localhost`, so the CDN TCP-resets the
//! connection (`ERR_CONNECTION_RESET`). We run a tiny local HTTP server that
//! forwards every request to the real CDN with the correct platform headers.
//!
//! Three routes:
//!
//!   `/img?url=…`     — image proxy (Referer: https://live.bilibili.com/)
//!   `/stream?url=…`  — HLS M3U8 proxy; rewrites every segment / sub-manifest
//!                      URL so the browser fetches it through `/seg` below
//!   `/seg?url=…`     — HLS segment proxy; streams TS / fMP4 bytes

use axum::body::Body;
use axum::{
    extract::Query,
    http::{header, HeaderValue, Response, StatusCode},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::sync::OnceLock;
use tower_http::cors::CorsLayer;

const DEFAULT_PORT: u16 = 34729;
const PROXY_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

static PORT: OnceLock<u16> = OnceLock::new();

/// Return the port the proxy is (or will be) listening on.
pub fn proxy_port() -> u16 {
    *PORT.get().unwrap_or(&DEFAULT_PORT)
}

/// Convert an original CDN image URL to its proxied form.
pub fn proxify(original: &str) -> String {
    if original.is_empty() {
        return String::new();
    }
    let port = proxy_port();
    format!(
        "http://127.0.0.1:{port}/img?url={}",
        percent_encode(original)
    )
}

/// Wrap a Bilibili HLS M3U8 URL so the browser fetches it through the local
/// proxy, which injects the correct `Referer`/`Origin` headers.
pub fn proxify_stream(original: &str) -> String {
    if original.is_empty() {
        return String::new();
    }
    let port = proxy_port();
    format!(
        "http://127.0.0.1:{port}/stream?url={}",
        percent_encode(original)
    )
}

/// Minimal percent-encoding for query-parameter values (RFC 3986).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => {
                use std::fmt::Write;
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

/// Spawn the image proxy server on the first available port starting from
/// `DEFAULT_PORT`. Must be called once at app startup (before any image URLs
/// are generated). Safe to call multiple times — subsequent calls are no-ops.
pub fn start() {
    if PORT.get().is_some() {
        return;
    }

    let port = find_free_port();
    // Set before spawning so `proxify` always returns a valid URL even if the
    // TCP server hasn't accepted its first connection yet.
    PORT.set(port).ok();

    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/img", get(image_handler))
            .route("/stream", get(stream_handler))
            .route("/seg", get(seg_handler))
            .layer(CorsLayer::very_permissive());

        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await {
            Ok(l) => l,
            Err(e) => {
                tracing::error!(port, error = %e, "proxy bind failed");
                return;
            }
        };

        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(error = %e, "proxy server error");
        }
    });
}

/// Find the first TCP port (starting from `DEFAULT_PORT`) that nothing is
/// listening on. Uses a short timeout so it doesn't block long.
fn find_free_port() -> u16 {
    use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
    use std::time::Duration;

    for p in DEFAULT_PORT..DEFAULT_PORT + 50 {
        let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, p);
        if TcpStream::connect_timeout(&addr.into(), Duration::from_millis(5)).is_err() {
            return p;
        }
    }
    DEFAULT_PORT
}

// ── Request handler ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ImgQuery {
    url: String,
}

async fn image_handler(Query(params): Query<ImgQuery>) -> Response<Body> {
    let url = params.url.trim().to_string();
    if url.is_empty() {
        return simple_error(StatusCode::BAD_REQUEST, "missing url");
    }

    let client = crate::platforms::http::shared_client();

    let mut req = client.get(&url).header("User-Agent", PROXY_UA).header(
        "Accept",
        "image/avif,image/webp,image/apng,image/*;q=0.8,*/*;q=0.5",
    );

    // Inject platform-specific Referer / Origin to bypass CDN hotlink checks.
    if url.contains("hdslb.com") || url.contains("bilibili.com") {
        req = req
            .header("Referer", "https://live.bilibili.com/")
            .header("Origin", "https://live.bilibili.com");
    }

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(url, error = %e, "proxy request failed");
            return simple_error(StatusCode::BAD_GATEWAY, "upstream request failed");
        }
    };

    if !upstream.status().is_success() {
        tracing::warn!(url, status = %upstream.status(), "upstream error");
        return simple_error(StatusCode::BAD_GATEWAY, "upstream returned non-2xx");
    }

    let ct = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    // Read full body to avoid Windows/WebView2 chunked-transfer issues
    // (same pattern as DTV competitor's proxy.rs).
    let bytes = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(url, error = %e, "proxy read bytes failed");
            return simple_error(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&ct).unwrap_or_else(|_| HeaderValue::from_static("image/jpeg")),
        )
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| simple_error(StatusCode::INTERNAL_SERVER_ERROR, "build failed"))
}

// ── HLS stream proxy ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct StreamQuery {
    url: String,
}

/// Proxy a Bilibili HLS M3U8 manifest.
///
/// Fetches the manifest with correct Bilibili headers, then rewrites every
/// segment / sub-manifest line so the browser requests them through `/seg`.
/// This prevents WebView2 from sending `Origin: tauri://localhost` directly
/// to the CDN (which causes `ERR_CONNECTION_RESET`).
async fn stream_handler(Query(params): Query<StreamQuery>) -> Response<Body> {
    let m3u8_url = params.url.trim().to_string();
    if m3u8_url.is_empty() {
        return simple_error(StatusCode::BAD_REQUEST, "missing url");
    }

    let client = crate::platforms::http::shared_client();

    let upstream = match client
        .get(&m3u8_url)
        .header("User-Agent", PROXY_UA)
        .header("Referer", "https://live.bilibili.com/")
        .header("Origin", "https://live.bilibili.com")
        .header(
            "Accept",
            "application/vnd.apple.mpegurl, application/x-mpegurl, */*",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(url = %m3u8_url, error = %e, "stream request failed");
            return simple_error(StatusCode::BAD_GATEWAY, "upstream request failed");
        }
    };

    if !upstream.status().is_success() {
        tracing::warn!(url = %m3u8_url, status = %upstream.status(), "stream upstream error");
        return simple_error(StatusCode::BAD_GATEWAY, "upstream returned non-2xx");
    }

    let text = match upstream.text().await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(url = %m3u8_url, error = %e, "stream read text failed");
            return simple_error(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
        }
    };

    // Derive the base URL for resolving relative segment paths.
    // Strip the query string, then keep everything up to and including the last slash.
    let base = {
        let no_query = m3u8_url.split('?').next().unwrap_or(&m3u8_url);
        match no_query.rfind('/') {
            Some(i) => no_query[..=i].to_string(),
            None => format!("{no_query}/"),
        }
    };

    let port = proxy_port();
    let rewritten = text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                // Rewrite URI="…" inside EXT-X-MAP tags (fMP4 init segment)
                if let Some(rest) = trimmed.strip_prefix("#EXT-X-MAP:") {
                    if let Some(rewritten_tag) = rewrite_tag_uri(rest, &base, port) {
                        return format!("#EXT-X-MAP:{rewritten_tag}");
                    }
                }
                return line.to_string();
            }
            // Regular segment or sub-manifest URL
            let full = resolve_url(trimmed, &base);
            format!("http://127.0.0.1:{port}/seg?url={}", percent_encode(&full))
        })
        .collect::<Vec<_>>()
        .join("\n");

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache, no-store")
        .body(Body::from(rewritten))
        .unwrap_or_else(|_| simple_error(StatusCode::INTERNAL_SERVER_ERROR, "build failed"))
}

/// Resolve a potentially-relative URL against a base.
fn resolve_url(url: &str, base: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else if url.starts_with('/') {
        // Protocol-relative or absolute path — prefix with the origin of base
        let origin_end = base
            .find("://")
            .and_then(|i| base[i + 3..].find('/').map(|j| i + 3 + j))
            .unwrap_or(base.len());
        format!("{}{}", &base[..origin_end], url)
    } else {
        format!("{base}{url}")
    }
}

/// Rewrite `URI="…"` inside an M3U8 tag attribute string.
fn rewrite_tag_uri(attrs: &str, base: &str, port: u16) -> Option<String> {
    let uri_key = "URI=\"";
    let start = attrs.find(uri_key)? + uri_key.len();
    let end = attrs[start..].find('"')? + start;
    let original_uri = &attrs[start..end];
    let full = resolve_url(original_uri, base);
    let proxied = format!("http://127.0.0.1:{port}/seg?url={}", percent_encode(&full));
    Some(format!(
        "{}URI=\"{}\"{}",
        &attrs[..start - uri_key.len()],
        proxied,
        &attrs[end + 1..]
    ))
}

// ── HLS segment proxy ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SegQuery {
    url: String,
}

/// Proxy a single HLS media segment (TS, fMP4, etc.).
async fn seg_handler(Query(params): Query<SegQuery>) -> Response<Body> {
    let seg_url = params.url.trim().to_string();
    if seg_url.is_empty() {
        return simple_error(StatusCode::BAD_REQUEST, "missing url");
    }

    let client = crate::platforms::http::shared_client();

    let upstream = match client
        .get(&seg_url)
        .header("User-Agent", PROXY_UA)
        .header("Referer", "https://live.bilibili.com/")
        .header("Origin", "https://live.bilibili.com")
        .header("Accept", "video/mp2t, video/mp4, */*")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(url = %seg_url, error = %e, "seg request failed");
            return simple_error(StatusCode::BAD_GATEWAY, "upstream request failed");
        }
    };

    if !upstream.status().is_success() {
        tracing::warn!(url = %seg_url, status = %upstream.status(), "seg upstream error");
        return simple_error(StatusCode::BAD_GATEWAY, "upstream returned non-2xx");
    }

    let ct = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp2t")
        .to_string();

    let bytes = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(url = %seg_url, error = %e, "seg read bytes failed");
            return simple_error(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&ct).unwrap_or_else(|_| HeaderValue::from_static("video/mp2t")),
        )
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| simple_error(StatusCode::INTERNAL_SERVER_ERROR, "build failed"))
}

fn simple_error(status: StatusCode, msg: &'static str) -> Response<Body> {
    // This should never fail in practice, but avoid unwrap for safety
    Response::builder()
        .status(status)
        .body(Body::from(msg))
        .unwrap_or_else(|_| Response::new(Body::from(msg)))
}
