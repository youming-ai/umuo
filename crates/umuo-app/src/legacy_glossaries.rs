//! 旧术语表的配置转移兼容。仅显式导入/导出时读取，不参与启动或翻译。

use std::io;
use std::path::Path;

/// 已发布的旧术语文件名，保留以支持配置转移。
pub const GLOSSARIES_FILE: &str = "glossaries.json";

/// 原样保留退役数据和未知字段，不解释或规范化术语条目。
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Glossaries {
    /// 旧表的完整 JSON 数据。
    #[serde(default)]
    pub lists: Vec<serde_json::Value>,
    /// 未来版本添加的顶层数据。
    #[serde(flatten)]
    pub extra: umuo_core::UnknownFields,
}

impl Glossaries {
    /// 显式配置转移时加载旧数据；损坏文件沿用配置备份策略。
    pub fn load(dir: &Path) -> Self {
        crate::persist::load_or_backup(dir, GLOSSARIES_FILE)
    }

    /// 显式导入配置时保存旧数据，不提供编辑或 CSV 导入功能。
    pub fn save(&self, dir: &Path) -> io::Result<()> {
        let json = serde_json::to_string_pretty(self).expect("旧术语数据可序列化");
        crate::persist::write_atomic(&dir.join(GLOSSARIES_FILE), json.as_bytes())
    }
}
