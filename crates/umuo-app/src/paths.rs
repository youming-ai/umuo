//! 配置目录在哪里：`~/Library/Application Support/app.umuo.desktop`。
//!
//! 已发布的版本一直用这个目录，改了老用户升级后设置与历史会全部「消失」，所以**不能改**。
//! Swift 宿主不自己拼路径，用这里的结果作 `Engine` 的配置目录。

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
    fn the_config_dir_is_the_one_released_versions_have_been_using() {
        assert_eq!(
            config_dir_for(Path::new("/Users/someone")),
            PathBuf::from("/Users/someone/Library/Application Support/app.umuo.desktop")
        );
    }
}
