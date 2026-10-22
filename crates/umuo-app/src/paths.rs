//! 配置目录在哪里：两个客户端必须指向**同一个**目录，否则老用户换到 Swift 版后设置与历史全部「消失」。
//!
//! Tauri 的 `app_config_dir()` 在 macOS 上是 `~/Library/Application Support/<identifier>`，
//! identifier 是 `tauri.conf.json` 里的 `app.umuo.desktop`（2026-10-21 在真机上确认过这个目录）。
//! Swift 版不自己拼路径，用这里的结果作 `Engine` 的配置目录。

use std::path::{Path, PathBuf};

/// Bundle ID。配置目录、Keychain 服务名、辅助功能授权都挂在它上面，**不能改**。
pub const BUNDLE_ID: &str = "app.umuo.desktop";

/// `home` 下的配置目录。
pub fn config_dir_for(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join(BUNDLE_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_config_dir_is_the_one_tauri_has_been_using() {
        assert_eq!(
            config_dir_for(Path::new("/Users/someone")),
            PathBuf::from("/Users/someone/Library/Application Support/app.umuo.desktop")
        );
    }
}
