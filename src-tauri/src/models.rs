use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub codex_path: Option<String>,
    pub codex_home: Option<String>,
    #[serde(default)]
    pub extra_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub diaries: Vec<DiaryEntry>,
    pub data_dir: String,
    pub failed_diary_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub kind: FeedbackKind,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliInfo {
    pub available: bool,
    pub source: Option<String>,
    pub path: Option<String>,
    pub version: Option<String>,
    pub update_help: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliUpdateInfo {
    pub path: Option<String>,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub status: String,
    pub can_update: bool,
    pub method: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliUpdateResult {
    pub cli: CodexCliInfo,
    pub retried_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedbackKind {
    Reward,
    Correction,
}

impl FeedbackKind {
    pub fn diary_label(self) -> &'static str {
        match self {
            Self::Reward => "奖励",
            Self::Correction => "挨打",
        }
    }

    pub fn event_name(self) -> &'static str {
        match self {
            Self::Reward => "reward",
            Self::Correction => "correction",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackReceipt {
    pub delivery: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub diary_queued: bool,
    #[serde(default)]
    pub context_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntry {
    pub id: String,
    pub created_at: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub reason: Option<String>,
    pub path: String,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub generated_by_codex: bool,
}

#[derive(Debug, Clone)]
pub struct DiaryDraft {
    pub created_at: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub reason: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub generated_by_codex: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLogEvent {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryGenerationFailure {
    pub message: String,
    pub pending_count: usize,
}
