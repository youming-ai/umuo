//! 存储层错误。

/// 存储层失败。
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("数据库错误：{0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("文件系统错误：{0}")]
    Io(String),

    /// 库是更新版本的程序写的（用户装回了旧版）。**不是损坏**：
    /// 按损坏处理会把新版留下的历史当垃圾挪走，所以单独成一类。
    #[error("历史数据库版本 v{found} 高于本程序支持的 v{supported}，请升级到最新版")]
    SchemaTooNew { found: i64, supported: i64 },
}

impl StoreError {
    /// 库文件损坏。这类失败需要给用户一条**不同的**出路（重建历史），
    /// 而不是笼统地说「数据库错误」。
    pub fn is_corruption(&self) -> bool {
        match self {
            StoreError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                code.code == rusqlite::ErrorCode::DatabaseCorrupt
                    || code.code == rusqlite::ErrorCode::NotADatabase
            }
            _ => false,
        }
    }
}
