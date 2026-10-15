//! 系统凭据存储（PRD §6.4）。
//!
//! 这是 BYOK 安全承诺的技术落点：**API Key 不进配置文件、不进日志、不进数据库**。
//! 三个平台各自的实现：macOS Keychain / Windows 凭据管理器 / Linux Secret Service。

use crate::error::PlatformError;

/// 按键取值的密钥库。`account` 是键名（例如 `openai`），不是用户名。
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, PlatformError>;

    fn set(&self, account: &str, secret: &str) -> Result<(), PlatformError>;

    fn delete(&self, account: &str) -> Result<(), PlatformError>;
}
