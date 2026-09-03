//! WBI signing for Bilibili web APIs (required by getDanmuInfo et al.).
//!
//! img_key/sub_key come from /x/web-interface/nav, are shuffled through a
//! fixed 64-entry table, first 32 chars form the mixin_key. Keys are cached
//! for 1 hour (wiliwili field practice).

use md5::{Digest, Md5};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
    29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const NAV_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/nav";
const KEY_TTL_SECS: u64 = 3600;

pub(crate) struct CachedKeys {
    pub img_key: String,
    pub sub_key: String,
    pub fetched_at: u64,
}

static KEYS: Mutex<Option<CachedKeys>> = Mutex::new(None);

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn mixin_key(img_key: &str, sub_key: &str) -> String {
    let orig = format!("{img_key}{sub_key}");
    let bytes = orig.as_bytes();
    MIXIN_KEY_ENC_TAB
        .iter()
        .take(32)
        .map(|&i| bytes[i] as char)
        .collect()
}

/// Bilibili's variant: unreserved chars pass through, `!'()*` are REMOVED
/// (not escaped), everything else is %XX upper-case.
pub(crate) fn url_encode(s: &str) -> String {
    s.chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() || "-_.~".contains(c) {
                Some(c.to_string())
            } else if "!'()*".contains(c) {
                None
            } else {
                let mut buf = [0u8; 4];
                Some(
                    c.encode_utf8(&mut buf)
                        .bytes()
                        .map(|b| format!("%{b:02X}"))
                        .collect(),
                )
            }
        })
        .collect()
}

pub(crate) fn sign_with_keys(
    mut params: Vec<(&str, String)>,
    keys: &CachedKeys,
    wts: u64,
) -> String {
    params.push(("wts", wts.to_string()));
    params.sort_by(|a, b| a.0.cmp(b.0));
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let mut hasher = Md5::new();
    hasher.update(format!("{}{}", query, mixin_key(&keys.img_key, &keys.sub_key)).as_bytes());
    format!("{}&w_rid={:x}", query, hasher.finalize())
}

fn take_filename(url: &str) -> Option<String> {
    url.rsplit('/')
        .next()
        .and_then(|s| s.split('.').next())
        .map(str::to_string)
}

async fn fetch_keys(client: &reqwest::Client, cookie: Option<&str>) -> Result<CachedKeys, String> {
    let mut req = client
        .get(NAV_ENDPOINT)
        .header(reqwest::header::USER_AGENT, super::DEFAULT_UA)
        .header(reqwest::header::REFERER, super::LIVE_REFERER);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    let payload: serde_json::Value = req
        .send()
        .await
        .map_err(|e| format!("nav request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("nav parse failed: {e}"))?;

    let img_url = payload
        .pointer("/data/wbi_img/img_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "nav missing wbi_img.img_url".to_string())?;
    let sub_url = payload
        .pointer("/data/wbi_img/sub_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "nav missing wbi_img.sub_url".to_string())?;

    Ok(CachedKeys {
        img_key: take_filename(img_url).ok_or_else(|| "bad img_url".to_string())?,
        sub_key: take_filename(sub_url).ok_or_else(|| "bad sub_url".to_string())?,
        fetched_at: now_secs(),
    })
}

async fn get_keys(client: &reqwest::Client, cookie: Option<&str>) -> Result<CachedKeys, String> {
    {
        let lock = KEYS.lock().map_err(|e| e.to_string())?;
        if let Some(keys) = lock.as_ref() {
            if now_secs().saturating_sub(keys.fetched_at) < KEY_TTL_SECS {
                return Ok(CachedKeys {
                    img_key: keys.img_key.clone(),
                    sub_key: keys.sub_key.clone(),
                    fetched_at: keys.fetched_at,
                });
            }
        }
    }
    let fresh = fetch_keys(client, cookie).await?;
    let mut lock = KEYS.lock().map_err(|e| e.to_string())?;
    *lock = Some(CachedKeys {
        img_key: fresh.img_key.clone(),
        sub_key: fresh.sub_key.clone(),
        fetched_at: fresh.fetched_at,
    });
    Ok(fresh)
}

/// Sign `params` and return a complete query string (`...&wts=N&w_rid=hex`).
pub(crate) async fn sign_wbi(
    client: &reqwest::Client,
    params: Vec<(&str, String)>,
    cookie: Option<&str>,
) -> Result<String, String> {
    let keys = get_keys(client, cookie).await?;
    Ok(sign_with_keys(params, &keys, now_secs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixin_key_matches_known_vector() {
        // Public test vector from bilibili-API-collect:
        let img = "7cd084941338484aae1ad9425b84077c";
        let sub = "4932caff0ff746eab6f01bf08b70ac45";
        assert_eq!(mixin_key(img, sub), "ea1db124af3c7062474693fa704f4ff8");
    }

    #[test]
    fn url_encode_strips_specials_and_escapes() {
        // !'()* must be removed entirely; space → %20; unreserved untouched
        assert_eq!(url_encode("a b!'()*c~"), "a%20bc~");
    }

    #[test]
    fn sign_appends_wts_and_w_rid_sorted() {
        let keys = CachedKeys {
            img_key: "7cd084941338484aae1ad9425b84077c".to_string(),
            sub_key: "4932caff0ff746eab6f01bf08b70ac45".to_string(),
            fetched_at: 0,
        };
        let signed = sign_with_keys(
            vec![("id", "123".to_string()), ("type", "0".to_string())],
            &keys,
            1_700_000_000,
        );
        assert!(
            signed.starts_with("id=123&type=0&wts=1700000000&w_rid="),
            "{signed}"
        );
        let rid = signed.rsplit("w_rid=").next().unwrap();
        assert_eq!(rid.len(), 32);
        assert!(rid.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
