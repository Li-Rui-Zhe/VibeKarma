use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub codex_path: Option<String>,
    pub codex_home: Option<String>,
    #[serde(default)]
    pub extra_env: BTreeMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_path: None,
            codex_home: None,
            extra_env: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub diaries: Vec<DiaryEntry>,
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub kind: FeedbackKind,
    pub reason: String,
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
