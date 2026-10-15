//! 配置导入导出（PRD §6.4）。
//!
//! **导出的东西里没有、也永远不会有 API Key。** Key 只存在系统 Keychain 里，
//! 设置与术语表都不含它——所以「导出默认不含 Key」不是这一层的一个开关选项，
//! 而是数据结构的必然结果。有测试守着这条不变量（新增字段踩到它会立刻失败）。
//!
//! 代价要说清楚：**换机器导入后要重新填 Key**。界面必须讲这一句，
//! 否则用户会以为"导入完了但用不了"是坏了。
//!
//! 为什么没有「勾选包含 Key 并加密」：加密导出的安全性取决于口令强度与实现细节，
//! 而它的收益只是省一次粘贴。在没做好之前不提供，比提供一个半成品安全
//! （见 `docs/PRD-CONFORMANCE.md` 的未对齐清单）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::glossaries::Glossaries;
use crate::settings::Settings;

/// 导出格式的版本。读到的比它新就拒绝——未来字段可能带语义，硬啃会出怪问题。
pub const BUNDLE_VERSION: u32 = 1;

/// 导出的默认文件名。稳定且会被覆盖：用户与我们只认这一个位置。
pub const EXPORT_FILE: &str = "umuo-config.json";

/// 导出包。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub version: u32,
    /// 导出这个包的客户端版本。**只用于事后排查**，不参与任何判断——
    /// 版本号参与逻辑就会变成一道随时会拦人的墙。
    pub app_version: String,
    pub settings: Settings,
    pub glossaries: Glossaries,
}

/// 导入结果摘要：让界面能如实说"应用了什么"，而不是只报一句"成功"。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub provider_id: String,
    pub target_lang: String,
    pub custom_style_count: usize,
    pub glossary_count: usize,
    pub bundle_version: u32,
}

/// 导出路径：`<home>/Downloads/umuo-config.json`。
///
/// 不弹文件选择器（本仓库没引 dialog 插件）：固定位置 + 界面显示完整路径，
/// 用户照样找得到；导入时路径可改，所以也不限于这一处。
pub fn export_path_in(home: &Path) -> PathBuf {
    home.join("Downloads").join(EXPORT_FILE)
}

/// 版本检查。纯函数，便于测试"未来版本要被拒绝"。
pub fn check_version(found: u32) -> Result<(), String> {
    if found > BUNDLE_VERSION {
        return Err(format!(
            "这个配置文件来自更新的版本（格式 v{found}，本机最高支持 v{BUNDLE_VERSION}）。请先升级 umuo。"
        ));
    }
    if found == 0 {
        return Err("配置文件缺少版本号，可能不是 umuo 导出的。".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glossaries::Glossaries;

    fn bundle() -> Bundle {
        Bundle {
            version: BUNDLE_VERSION,
            app_version: "0.1.0".to_string(),
            settings: Settings::default(),
            glossaries: Glossaries::default(),
        }
    }

    #[test]
    fn a_bundle_survives_a_round_trip() {
        let original = bundle();
        let json = serde_json::to_string_pretty(&original).unwrap();
        assert_eq!(serde_json::from_str::<Bundle>(&json).unwrap(), original);
    }

    #[test]
    fn the_exported_file_never_has_a_credential_field() {
        // 与 settings 的守卫同一不变量，但**检查字段名**而不是全文子串——
        // 黑名单的值里有 "1Password"（我们拒绝读取的应用名），按值匹配会把
        // 合法内容误判成泄密（这条测试第一版就是这么挂的）。
        let value = serde_json::to_value(bundle()).unwrap();
        let mut keys = Vec::new();
        fn collect(value: &serde_json::Value, out: &mut Vec<String>) {
            match value {
                serde_json::Value::Object(map) => {
                    for (k, v) in map {
                        out.push(k.clone());
                        collect(v, out);
                    }
                }
                serde_json::Value::Array(items) => {
                    for item in items {
                        collect(item, out);
                    }
                }
                _ => {}
            }
        }
        collect(&value, &mut keys);

        for key in &keys {
            let lower = key.to_lowercase();
            for forbidden in ["apikey", "api_key", "secret", "token", "password", "bearer"] {
                assert!(
                    !lower.contains(forbidden),
                    "导出文件里出现了疑似凭据字段 {key}（含 {forbidden}）"
                );
            }
        }
    }

    #[test]
    fn a_future_version_is_refused_with_an_actionable_message() {
        let error = check_version(BUNDLE_VERSION + 1).unwrap_err();
        assert!(error.contains("升级"), "错误信息要给出下一步：{error}");
    }

    #[test]
    fn the_current_version_is_accepted() {
        assert!(check_version(BUNDLE_VERSION).is_ok());
        // 旧版本可以读：字段只增不改语义。
        assert!(check_version(1).is_ok());
    }

    #[test]
    fn a_file_without_a_version_is_refused() {
        // serde 会给 `version` 一个 0；那多半是别的 JSON 被误当成配置。
        assert!(check_version(0).is_err());
    }

    #[test]
    fn the_export_path_is_predictable() {
        let path = export_path_in(Path::new("/Users/someone"));
        assert_eq!(
            path,
            PathBuf::from("/Users/someone/Downloads/umuo-config.json")
        );
    }
}
