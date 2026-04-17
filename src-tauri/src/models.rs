use serde::{Deserialize, Serialize};

// ── Replay ────────────────────────────────────────────────────────────────────

/// A playable quality option returned by getStreamUrlWeb.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayQuality {
    /// Display name: "超清" / "高清" / "标清" / "流畅"
    pub name: String,
    /// Playback URL (m3u8 or mp4)
    pub url: String,
    /// Bitrate in kbps
    pub bit_rate: u32,
    /// Quality level (higher = better): 4 / 3 / 2 / 1
    pub level: u32,
}

/// One playable segment (part / 分P) of a live recording.
///
/// A single live session can be split across several parts (P1, P2, P3 …).
/// `get_replay_list` returns one `ReplayItem` per **session** (the first part,
/// with `part_num = 1` and `total_parts = re_num`).
/// `get_replay_parts` returns all parts for a chosen session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayItem {
    /// Unique video identifier: hash_id (Douyu) / bvid (Bilibili)
    pub id: String,
    pub platform: PlatformId,
    pub room_id: String,
    /// Full title of this specific segment
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    /// Duration display string, e.g. "120:01" or "02:00:01"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_str: Option<String>,
    /// Duration in seconds (derived from duration_str)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<u64>,
    /// Unix timestamp (seconds) when the live session started
    pub recorded_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count_text: Option<String>,

    // ── Multi-part support ────────────────────────────────────────────────
    /// This segment's position within the session (1-based)
    pub part_num: u32,
    /// Total number of parts in the session
    pub total_parts: u32,
    /// Numeric session ID (Douyu: show_id), used to fetch sibling parts
    pub show_id: i64,
    /// Short label for the segment, e.g. "21点场" / "23点场"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_remark: Option<String>,
    /// VOD platform author ID needed to call getShowReplayList
    pub up_id: String,
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_count_text: Option<String>,
    pub is_live: bool,
    pub followed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub keyword: String,
    pub items: Vec<RoomCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    System,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    /// Disable all proxy (default, safe for most users).
    #[default]
    None,
    /// Use OS / environment variable proxy settings.
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastVisited {
    #[serde(rename = "type")]
    pub visit_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<PlatformId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_visited: Option<LastVisited>,
}
