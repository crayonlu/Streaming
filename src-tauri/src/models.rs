use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformId {
    Bilibili,
    Douyu,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomCard {
    pub id: String,
    pub platform: PlatformId,
    pub room_id: String,
    pub title: String,
    pub streamer_name: String,
    pub cover_url: String,
    pub area_name: Option<String>,
    pub viewer_count_text: Option<String>,
    pub is_live: bool,
    pub followed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub keyword: String,
    pub items: Vec<RoomCard>,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDetail {
    pub id: String,
    pub platform: PlatformId,
    pub room_id: String,
    pub title: String,
    pub streamer_name: String,
    pub avatar_url: Option<String>,
    pub cover_url: Option<String>,
    pub area_name: Option<String>,
    pub description: Option<String>,
    pub is_live: bool,
    pub followed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamFormat {
    Hls,
    Flv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSource {
    pub id: String,
    pub platform: PlatformId,
    pub room_id: String,
    pub quality_key: String,
    pub quality_label: String,
    pub stream_url: String,
    pub format: StreamFormat,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    System,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    /// Disable all proxy (default, safe for most users).
    None,
    /// Use OS / environment variable proxy settings.
    System,
}

impl Default for ProxyMode {
    fn default() -> Self {
        ProxyMode::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastVisited {
    #[serde(rename = "type")]
    pub visit_type: String,
    pub platform: Option<PlatformId>,
    pub room_id: Option<String>,
    pub keyword: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub default_platform: PlatformId,
    pub resume_last_session: bool,
    pub appearance: Appearance,
    #[serde(default)]
    pub proxy: ProxyMode,
    pub last_visited: Option<LastVisited>,
}
