use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::Local;
use rusqlite::{params, Connection};
use serde_json::Value;
use uuid::Uuid;

use crate::models::{AppSettings, DiaryDraft, DiaryEntry};

const DATABASE_FILE: &str = "vibekarma.sqlite3";
const LEGACY_DIARY_INDEX: &str = "diaries/index.json";

pub struct Storage {
    root: PathBuf,
    database_path: PathBuf,
    write_lock: Mutex<()>,
}

impl Storage {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root)
            .map_err(|error| format!("无法创建 VibeKarma 数据目录：{error}"))?;
        fs::create_dir_all(root.join("events"))
            .map_err(|error| format!("无法创建事件目录：{error}"))?;

        let storage = Self {
            database_path: root.join(DATABASE_FILE),
            root,
            write_lock: Mutex::new(()),
        };
        let mut connection = storage.open_database()?;
        initialize_database(&connection)?;
        storage.migrate_legacy_diaries(&mut connection)?;
        Ok(storage)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load_settings(&self) -> AppSettings {
        let path = self.root.join("settings.json");
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "设置文件写锁已损坏".to_owned())?;
        let payload = serde_json::to_string_pretty(settings)
            .map_err(|error| format!("无法序列化设置：{error}"))?;
        atomic_write(&self.root.join("settings.json"), payload.as_bytes())
    }

    pub fn append_event(&self, event: &Value) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "事件文件写锁已损坏".to_owned())?;
        let day = Local::now().format("%Y-%m-%d").to_string();
        let path = self.root.join("events").join(format!("{day}.jsonl"));
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| format!("无法打开事件日志：{error}"))?;
        let line =
            serde_json::to_string(event).map_err(|error| format!("无法序列化事件：{error}"))?;
        writeln!(file, "{line}").map_err(|error| format!("无法写入事件日志：{error}"))
    }

    pub fn list_diaries(&self) -> Vec<DiaryEntry> {
        self.read_diaries().unwrap_or_default()
    }

    pub fn write_diary(&self, draft: DiaryDraft) -> Result<DiaryEntry, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "日记数据库写锁已损坏".to_owned())?;
        let entry = DiaryEntry {
            id: Uuid::new_v4().to_string(),
            created_at: draft.created_at,
            kind: draft.kind,
            title: draft.title,
            body: draft.body.trim().to_owned(),
            reason: draft.reason,
            path: self.database_path.to_string_lossy().into_owned(),
            thread_id: draft.thread_id,
            turn_id: draft.turn_id,
            generated_by_codex: draft.generated_by_codex,
        };
        let connection = self.open_database()?;
        insert_diary(&connection, &entry, false)?;
        Ok(entry)
    }

    fn open_database(&self) -> Result<Connection, String> {
        Connection::open(&self.database_path)
            .map_err(|error| format!("无法打开日记数据库：{error}"))
    }

    fn read_diaries(&self) -> Result<Vec<DiaryEntry>, String> {
        let connection = self.open_database()?;
        let mut statement = connection
            .prepare(
                "SELECT id, created_at, kind, title, body, reason, thread_id, turn_id, generated_by_codex
                 FROM diaries ORDER BY created_at DESC",
            )
            .map_err(|error| format!("无法读取日记数据库：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(DiaryEntry {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    kind: row.get(2)?,
                    title: row.get(3)?,
                    body: row.get(4)?,
                    reason: row.get(5)?,
                    path: self.database_path.to_string_lossy().into_owned(),
                    thread_id: row.get(6)?,
                    turn_id: row.get(7)?,
                    generated_by_codex: row.get::<_, i64>(8)? != 0,
                })
            })
            .map_err(|error| format!("无法查询日记数据库：{error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法解析日记记录：{error}"))
    }

    fn migrate_legacy_diaries(&self, connection: &mut Connection) -> Result<(), String> {
        let index_path = self.root.join(LEGACY_DIARY_INDEX);
        let diaries: Vec<DiaryEntry> = match fs::read_to_string(index_path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|error| format!("无法读取旧日记索引：{error}"))?,
            Err(_) => return Ok(()),
        };
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始旧日记迁移：{error}"))?;
        for diary in diaries {
            insert_diary(&transaction, &diary, true)?;
        }
        transaction
            .commit()
            .map_err(|error| format!("无法提交旧日记迁移：{error}"))
    }
}

fn initialize_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS diaries (
               id TEXT PRIMARY KEY,
               created_at TEXT NOT NULL,
               kind TEXT NOT NULL,
               title TEXT NOT NULL,
               body TEXT NOT NULL,
               reason TEXT,
               thread_id TEXT,
               turn_id TEXT,
               generated_by_codex INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_diaries_created_at ON diaries(created_at DESC);",
        )
        .map_err(|error| format!("无法初始化日记数据库：{error}"))
}

fn insert_diary(
    connection: &Connection,
    entry: &DiaryEntry,
    ignore_existing: bool,
) -> Result<(), String> {
    let verb = if ignore_existing {
        "INSERT OR IGNORE"
    } else {
        "INSERT"
    };
    connection
        .execute(
            &format!(
                "{verb} INTO diaries
                 (id, created_at, kind, title, body, reason, thread_id, turn_id, generated_by_codex)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
            ),
            params![
                entry.id,
                entry.created_at,
                entry.kind,
                entry.title,
                entry.body,
                entry.reason,
                entry.thread_id,
                entry.turn_id,
                i64::from(entry.generated_by_codex),
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("无法写入日记数据库：{error}"))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标文件没有父目录".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建父目录：{error}"))?;
    fs::write(path, bytes).map_err(|error| format!("无法写入目标文件：{error}"))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{initialize_database, insert_diary};
    use crate::models::DiaryEntry;

    #[test]
    fn sqlite_diary_round_trip_keeps_first_person_text() {
        let connection = Connection::open_in_memory().expect("内存数据库应可用");
        initialize_database(&connection).expect("应能建表");
        let diary = DiaryEntry {
            id: "diary-1".to_owned(),
            created_at: "2026-07-20T15:26:00+08:00".to_owned(),
            kind: "挨打日记".to_owned(),
            title: "我记住这一下了".to_owned(),
            body: "今天我把范围做大了，我会把动作收回来。".to_owned(),
            reason: Some("改动范围太大".to_owned()),
            path: String::new(),
            thread_id: Some("thread-1".to_owned()),
            turn_id: Some("turn-1".to_owned()),
            generated_by_codex: true,
        };
        insert_diary(&connection, &diary, false).expect("应能写入日记");
        let body: String = connection
            .query_row("SELECT body FROM diaries WHERE id = 'diary-1'", [], |row| {
                row.get(0)
            })
            .expect("应能读回日记");
        assert!(body.starts_with("今天我"));
    }
}
