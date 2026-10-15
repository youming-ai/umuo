//! API Key 存 macOS Keychain（PRD §6.4）。
//!
//! 走 `keyring` 而不是直接调 Security.framework：同一套调用点在 V1.1 接 Windows
//! 凭据管理器、V2 接 Linux Secret Service 时都不用改——换的只是 Cargo 里的 feature。
//!
//! **Key 不进配置文件、不进日志、不进翻译历史。** 这个模块是那条承诺的唯一落点。

use umuo_platform::{PlatformError, SecretStore};

use crate::KEYCHAIN_SERVICE;

pub struct MacSecretStore;

impl MacSecretStore {
    fn entry(account: &str) -> Result<keyring::Entry, PlatformError> {
        keyring::Entry::new(KEYCHAIN_SERVICE, account)
            .map_err(|e| PlatformError::SecretStore(e.to_string()))
    }
}

impl SecretStore for MacSecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, PlatformError> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            // 「没存过」是正常状态，不是错误——首次启动就是这个分支。
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(PlatformError::SecretStore(e.to_string())),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), PlatformError> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|e| PlatformError::SecretStore(e.to_string()))
    }

    fn delete(&self, account: &str) -> Result<(), PlatformError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) => Ok(()),
            // 删一个本来就不存在的条目算成功，否则「清空全部 Key」会中途报错。
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(PlatformError::SecretStore(e.to_string())),
        }
    }
}
