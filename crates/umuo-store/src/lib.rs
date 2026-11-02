//! umuo 的本机存储：翻译历史（PRD §5.9）。
//!
//! 收藏与用量账本已退出界面：`favorites` / `usage` 两张表与已发布迁移原样保留、旧数据不删，
//! 但这里不再提供它们的读写函数。
//!
//! 只用 SQLite，只用本机文件。**这里不存 API Key**，也不存任何用于识别的信息——
//! 历史的用途是「我上次是怎么译的」，不是「这个人是谁」。
//!
//! ## 为什么不用 FTS5 做全文检索
//!
//! PRD 要求「支持全文检索」。FTS5 听起来是标准答案，但它的默认 tokenizer
//! （`unicode61`）**不切分中日韩文本**：一整句中文会被当成一个 token，
//! 搜其中的某个词根本命中不了——除非再引入分词器（体积与复杂度都上一个台阶）。
//!
//! 本机历史的规模是「几千到几万条」，`LIKE '%词%'` 在这个量级上是毫秒级，
//! 而且对中文是真能搜到的。所以这里用 LIKE，并把理由写在这里，
//! 免得以后有人「顺手优化成 FTS5」反而把中文搜索弄坏。
//!
//! ## 迁移约定
//!
//! 版本号存在 `PRAGMA user_version`。**已经发布的迁移不要改**——
//! 用户的库只会执行比它当前版本更高的那些；改旧迁移对既有库完全无效，
//! 只会让新库与旧库的形状悄悄分叉。要改就加 `MIGRATIONS` 里的新一版。

pub mod error;
pub mod history;

use std::path::{Path, PathBuf};

use rusqlite::Connection;

pub use error::StoreError;
pub use history::{HistoryFilter, NewRecord, Record};

/// 建表语句，按版本递进。
///
/// 每一项是「从上一版升到本版」的脚本。空切片项表示该版本没有结构变化
/// （保留位置，让下标与版本号一一对应）。
const MIGRATIONS: &[&str] = &[
    // v1：初始结构
    "
    CREATE TABLE history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at      INTEGER NOT NULL,
      source_text     TEXT    NOT NULL,
      translated_text TEXT    NOT NULL,
      source_lang     TEXT,
      target_lang     TEXT    NOT NULL,
      provider_id     TEXT    NOT NULL,
      model           TEXT    NOT NULL,
      style_id        TEXT    NOT NULL,
      scene           TEXT    NOT NULL,
      source_app      TEXT,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      estimated       INTEGER NOT NULL DEFAULT 0,
      cost_usd        REAL
    );
    CREATE INDEX idx_history_created_at ON history(created_at DESC);

    CREATE TABLE favorites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  INTEGER NOT NULL,
      kind        TEXT    NOT NULL,
      text        TEXT    NOT NULL,
      translation TEXT,
      source_lang TEXT,
      target_lang TEXT,
      UNIQUE(kind, text)
    );
    CREATE INDEX idx_favorites_created_at ON favorites(created_at DESC);
    ",
    // v2：独立的用量账本。
    //
    // 月度上限与用量统计原本直接 SUM 历史表，于是关掉历史、开隐私模式、清空历史、
    // 保留期清理都会让「本月花了多少」变少，上限形同虚设。账本只存计费需要的字段
    // （时间、供应商、模型、token、费用），**不存原文与译文**，所以不受上面任何一项影响。
    //
    // 同一脚本里从历史表回填：否则月中升级的用户本月已花的钱会突然归零。
    "
    CREATE TABLE usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    INTEGER NOT NULL,
      provider_id   TEXT    NOT NULL,
      model         TEXT    NOT NULL,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated     INTEGER NOT NULL DEFAULT 0,
      cost_usd      REAL
    );
    CREATE INDEX idx_usage_created_at ON usage(created_at);

    INSERT INTO usage (created_at, provider_id, model, input_tokens, output_tokens, estimated, cost_usd)
      SELECT created_at, provider_id, model, input_tokens, output_tokens, estimated, cost_usd
      FROM history ORDER BY id;
    ",
];

/// 本机数据库句柄。
pub struct Store {
    conn: Connection,
}

impl Store {
    /// 打开（必要时创建）磁盘上的库，并跑到最新结构。
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            // 目录不存在时 SQLite 只会报「unable to open database file」，
            // 那个错误对用户毫无信息量，所以这里自己建目录。
            std::fs::create_dir_all(parent).map_err(|e| StoreError::Io(e.to_string()))?;
        }
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    /// 打开库；库文件损坏时把它（连同 WAL 旁路文件）挪成 `.corrupt-<时间戳>` 再建一个新库。
    ///
    /// 返回挪走后的备份路径（没损坏时为 `None`），调用方据此告诉用户发生了什么。
    /// 只认 [`StoreError::is_corruption`]：版本过新、目录没权限这类失败原样返回——
    /// 那些情况下挪走文件只会毁掉本来完好的数据。
    pub fn open_recovering(path: &Path) -> Result<(Self, Option<PathBuf>), StoreError> {
        match Self::open(path) {
            Ok(store) => Ok((store, None)),
            Err(error) if error.is_corruption() => {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let backup = with_suffix(path, &format!(".corrupt-{stamp}"));
                std::fs::rename(path, &backup).map_err(|e| StoreError::Io(e.to_string()))?;
                // WAL 模式的旁路文件属于旧库，留着会被新库当成自己的日志重放。
                for side in ["-wal", "-shm"] {
                    let from = with_suffix(path, side);
                    if from.exists() && std::fs::rename(&from, with_suffix(&backup, side)).is_err()
                    {
                        let _ = std::fs::remove_file(&from);
                    }
                }
                Ok((Self::open(path)?, Some(backup)))
            }
            Err(error) => Err(error),
        }
    }

    /// 内存库。测试用它——不碰用户的真实历史，也不需要清理。
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self, StoreError> {
        // 外键与 WAL：历史是「写多读少」的追加型数据，WAL 让写入不阻塞读取。
        // 单文件本地库上 WAL 的代价可以忽略。
        conn.busy_timeout(std::time::Duration::from_millis(2000))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), StoreError> {
        let current: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;

        // 新版程序写过的库（用户装回了旧版）：拒绝打开，而不是带着看不懂的结构照常读写。
        let supported = MIGRATIONS.len() as i64;
        if current > supported {
            return Err(StoreError::SchemaTooNew {
                found: current,
                supported,
            });
        }

        for (index, script) in MIGRATIONS.iter().enumerate() {
            let version = index as i64 + 1;
            if version <= current {
                continue;
            }
            // 整个迁移放在一个事务里：中途失败时 user_version 不会前进，
            // 下次启动重试，而不是留下一个半升级的库。
            let tx = self.conn.unchecked_transaction()?;
            tx.execute_batch(script)?;
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()?;
        }
        Ok(())
    }

    /// 只读连接（给测试与诊断用）。
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// 当前结构版本。设置页的「关于」里可以显示它，便于排查。
    pub fn schema_version(&self) -> Result<i64, StoreError> {
        Ok(self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }
}

/// `history.db` + `-wal` → `history.db-wal`。`Path::with_extension` 会吃掉原扩展名，不能用。
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_an_in_memory_store_lands_on_the_latest_schema_version() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        // 已经升级过的库再跑一遍迁移不该报错，也不该重复建表。
        let path = std::env::temp_dir().join("umuo-store-migrate-test.db");
        let _ = std::fs::remove_file(&path);
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn opening_creates_missing_parent_directories() {
        // 直接 open 一个不存在的目录会在 SQLite 层报「unable to open database file」，
        // 那个信息对用户毫无用处。
        let dir = std::env::temp_dir().join("umuo-store-nested/a/b");
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("umuo-store-nested"));
        let path = dir.join("history.db");
        let store = Store::open(&path).expect("应自动创建目录");
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("umuo-store-nested"));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("umuo-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_database_written_by_a_newer_version_is_refused_not_misread() {
        let dir = temp_dir("too-new");
        let path = dir.join("history.db");
        {
            let store = Store::open(&path).unwrap();
            store
                .connection()
                .pragma_update(None, "user_version", 99)
                .unwrap();
        }
        let error = Store::open(&path).err().expect("版本过高应拒绝打开");
        assert!(matches!(error, StoreError::SchemaTooNew { found: 99, .. }));
        // 过新不是损坏：恢复流程不能把它挪走。
        assert!(!error.is_corruption());
        assert!(Store::open_recovering(&path).is_err());
        assert!(path.exists(), "过新的库必须原样留着");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_file_is_detected_and_moved_aside_for_a_fresh_store() {
        let dir = temp_dir("corrupt");
        let path = dir.join("history.db");
        std::fs::write(&path, vec![0x5a_u8; 8192]).unwrap();

        let error = Store::open(&path).err().expect("垃圾文件不该被当成库");
        assert!(error.is_corruption(), "应识别为损坏：{error}");

        let (store, backup) = Store::open_recovering(&path).unwrap();
        let backup = backup.expect("应返回备份路径");
        assert!(backup.exists(), "原文件应被保留成备份");
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("history.db.corrupt-"));
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as i64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_healthy_store_is_opened_without_any_backup() {
        let dir = temp_dir("healthy");
        let path = dir.join("history.db");
        let (_, backup) = Store::open_recovering(&path).unwrap();
        assert!(backup.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upgrading_from_v1_backfills_the_usage_ledger_from_history() {
        // 月中升级的用户，本月已花的钱不能因为换了数据来源而归零。
        let dir = temp_dir("backfill");
        let path = dir.join("history.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(MIGRATIONS[0]).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            conn.execute(
                "INSERT INTO history (created_at, source_text, translated_text, target_lang,
                 provider_id, model, style_id, scene, input_tokens, output_tokens, cost_usd)
                 VALUES (100, 'a', '甲', 'zh-CN', 'openai', 'gpt-4o-mini', 'standard',
                 'selection', 10, 20, 1.5)",
                [],
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        // 账本已停写，但已发布的 v2 迁移照旧执行：回填的数据原样留在库里。
        let (count, input, output, cost): (u32, u32, u32, f64) = store
            .connection()
            .query_row(
                "SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) FROM usage",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!((input, output), (10, 20));
        assert!((cost - 1.5).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
