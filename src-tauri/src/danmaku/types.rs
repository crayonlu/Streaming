/// Unified danmaku event pushed to the frontend on `danmaku-event`.
/// Flat struct (not a tagged enum) keeps serde/TS contracts trivial.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuEvent {
    pub kind: String, // "chat" | "online" | "status"
    pub platform: crate::models::PlatformId,
    pub room_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>, // "#rrggbb"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_level: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>, // online
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>, // status: "connected" | "reconnecting" | "closed"
}
