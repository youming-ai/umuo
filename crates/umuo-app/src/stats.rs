//! 对比偏好的本地统计（PRD §5.6：标记「最佳」，偏好用于推荐默认模型）。
//!
//! 只存两个东西：`providerId:model` 与它被标记的次数。**刻意不存翻译内容**——
//! 「哪个模型更合我口味」这件事不需要把用户译过什么一并留下。
//!
//! 与 `settings.json` 分开放：设置是用户显式配置的，统计是行为副产品，
//! 两者的损坏代价不同（统计丢了无所谓，设置丢了要重配），混在一个文件里
//! 会让「一次坏写入」同时毁掉两边。

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const STATS_FILE: &str = "stats.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Stats {
    /// `providerId:model` → 被标记为「最佳」的次数。
    pub compare_picks: BTreeMap<String, u32>,
    /// 本版本不认识的字段，见 [`umuo_core::UnknownFields`]。
    #[serde(flatten)]
    pub extra: umuo_core::UnknownFields,
}

/// 偏好条目的键。用 `:` 分隔而不是嵌套结构：统计文件要能手改，
/// 一行一条读起来最省事。
pub fn pick_key(provider_id: &str, model: &str) -> String {
    format!("{provider_id}:{model}")
}

impl Stats {
    /// 读统计。文件不存在或解析失败一律回落到空——统计丢了大不了重新积累，
    /// 但它绝不该拦住客户端启动。
    pub fn load(dir: &Path) -> Self {
        fs::read_to_string(dir.join(STATS_FILE))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// 原子写（临时文件 + rename），与设置、术语表同一口径。
    pub fn save(&self, dir: &Path) -> io::Result<()> {
        let json = serde_json::to_string_pretty(self).expect("统计结构体一定可序列化");
        crate::persist::write_atomic(&dir.join(STATS_FILE), json.as_bytes())
    }

    /// 记一次「选它」。返回被记下的键，便于调用方回显。
    pub fn record_pick(&mut self, provider_id: &str, model: &str) -> String {
        let key = pick_key(provider_id, model);
        *self.compare_picks.entry(key.clone()).or_insert(0) += 1;
        key
    }

    /// 按被选次数降序排列。次数相同时按键升序——**顺序必须稳定**，
    /// 否则设置页里「最常被选中」会在每次打开时换一个，看起来像 bug。
    pub fn ranking(&self) -> Vec<(String, u32)> {
        let mut items: Vec<(String, u32)> = self
            .compare_picks
            .iter()
            .map(|(key, count)| (key.clone(), *count))
            .collect();
        items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        items
    }

    /// 最常被选中的那一个。没有任何记录时为 `None`（而不是硬推一个默认值）。
    pub fn top(&self) -> Option<(String, u32)> {
        self.ranking().into_iter().next()
    }
}

/// 把一个键拆回 `(provider_id, model)`。模型名本身可能含 `:`，
/// 所以按**第一个**冒号切分，而不是按全部切分。
pub fn split_pick_key(key: &str) -> Option<(&str, &str)> {
    let (provider_id, model) = key.split_once(':')?;
    (!provider_id.is_empty() && !model.is_empty()).then_some((provider_id, model))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn unknown_fields_in_the_stats_file_survive_load_and_save() {
        let dir = temp_dir("unknown");
        fs::write(
            dir.join(STATS_FILE),
            r#"{"comparePicks":{"openai:m":2},"futureCounter":7}"#,
        )
        .unwrap();
        Stats::load(&dir).save(&dir).unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(STATS_FILE)).unwrap()).unwrap();
        assert_eq!(saved["futureCounter"], 7);
        assert_eq!(saved["comparePicks"]["openai:m"], 2);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("umuo-stats-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recording_a_pick_increments_its_count() {
        let mut stats = Stats::default();
        stats.record_pick("openai", "gpt-4o-mini");
        stats.record_pick("openai", "gpt-4o-mini");
        stats.record_pick("deepseek", "deepseek-chat");
        assert_eq!(stats.compare_picks["openai:gpt-4o-mini"], 2);
        assert_eq!(stats.compare_picks["deepseek:deepseek-chat"], 1);
    }

    #[test]
    fn ranking_is_by_count_then_alphabetical_so_the_order_never_jitters() {
        // 顺序不稳定的话，设置页里的「最常被选中」每次打开都换一个，像 bug。
        let mut stats = Stats::default();
        stats.record_pick("z", "model");
        stats.record_pick("a", "model");
        stats.record_pick("a", "model");

        let ranking = stats.ranking();
        assert_eq!(ranking[0].0, "a:model", "次数多的在前");
        assert_eq!(ranking[1].0, "z:model");
    }

    #[test]
    fn top_is_none_when_nothing_was_ever_picked() {
        // 没有任何记录时不该硬推一个「推荐模型」出来。
        assert!(Stats::default().top().is_none());
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = temp_dir("roundtrip");
        let mut stats = Stats::default();
        stats.record_pick("openai", "gpt-4o-mini");
        stats.save(&dir).unwrap();
        assert_eq!(Stats::load(&dir), stats);
    }

    #[test]
    fn a_missing_or_corrupt_file_yields_empty_stats_instead_of_failing_startup() {
        let dir = temp_dir("corrupt");
        assert_eq!(Stats::load(&dir), Stats::default());

        fs::write(dir.join(STATS_FILE), "{ 这不是 JSON").unwrap();
        assert_eq!(Stats::load(&dir), Stats::default());
    }

    #[test]
    fn pick_keys_survive_model_names_that_contain_colons() {
        // 有些供应商的模型名带冒号（例如 Ollama 的 `qwen2.5:7b`）。
        let key = pick_key("ollama", "qwen2.5:7b");
        assert_eq!(split_pick_key(&key), Some(("ollama", "qwen2.5:7b")));
        assert_eq!(split_pick_key("no-separator"), None);
        assert_eq!(split_pick_key(":model"), None);
    }
}
