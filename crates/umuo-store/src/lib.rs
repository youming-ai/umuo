//! umuo 的本机存储：翻译历史、收藏与用量统计（PRD §5.9、§5.10）。
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
pub mod favorites;
pub mod history;

use std::path::Path;

use rusqlite::Connection;

pub use error::StoreError;
pub use favorites::{Favorite, FavoriteKind, NewFavorite};
pub use history::{
    DayUsage, Facets, HistoryFilter, NewRecord, ProviderUsage, Record, UsageSummary,
};

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

    /// 内存库。测试用它——不碰用户的真实历史，也不需要清理。
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self, StoreError> {
        // 外键与 WAL：历史是「写多读少」的追加型数据，WAL 让写入不阻塞读取。
        // 单文件本地库上 WAL 的代价可以忽略。
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
            assert_eq!(store.schema_version().unwrap(), 1);
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.schema_version().unwrap(), 1);
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
        assert_eq!(store.schema_version().unwrap(), 1);
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("umuo-store-nested"));
    }
}
