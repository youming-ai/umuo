//! 存储层错误。

/// 存储层失败。
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("数据库错误：{0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("文件系统错误：{0}")]
    Io(String),
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
