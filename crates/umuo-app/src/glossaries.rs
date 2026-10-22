//! 术语表的持久化（PRD §5.8）。
//!
//! **不放进 `settings.json`。** 一张真用起来的术语表可能有几百上千条，
//! 塞进设置文件会让它膨胀到没法人工查看；而设置文件的定位恰恰是「小、能手改」。
//! 这与 `stats.json` 单开一个文件的理由一致：按**数据的性质**分文件，
//! 而不是按「都是配置」硬塞在一起。
//!
//! 读写行为刻意与 `settings.json` 对齐（共用 [`crate::persist`]）：原子写；读不动或解析失败时
//! 备份成 `.corrupt-<时间戳>` 再回落空表，用户手改坏一个字符时至少还能看到原文件。

use std::io;
use std::path::Path;

use umuo_core::glossary::{self, Glossary, GlossaryEntry};

pub const GLOSSARIES_FILE: &str = "glossaries.json";

/// 全部术语表。
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Glossaries {
    #[serde(default)]
    pub lists: Vec<Glossary>,
    /// 本版本不认识的字段，见 [`umuo_core::UnknownFields`]。
    #[serde(flatten)]
    pub extra: umuo_core::UnknownFields,
}

impl Glossaries {
    pub fn load(dir: &Path) -> Self {
        crate::persist::load_or_backup(dir, GLOSSARIES_FILE)
    }

    pub fn save(&self, dir: &Path) -> io::Result<()> {
        let json = serde_json::to_string_pretty(self).expect("术语表一定可序列化");
        crate::persist::write_atomic(&dir.join(GLOSSARIES_FILE), json.as_bytes())
    }

    /// 按 id 覆盖或追加。与设置页的「保存」是同一套语义：
    /// 不区分新建与编辑，少一条分支就少一处不一致。
    pub fn upsert(&mut self, list: Glossary) {
        match self.lists.iter_mut().find(|item| item.id == list.id) {
            Some(existing) => *existing = list,
            None => self.lists.push(list),
        }
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.lists.len();
        self.lists.retain(|item| item.id != id);
        self.lists.len() != before
    }

    /// 解析 CSV / TSV 并**替换**某张表的全部条目（导入即覆盖）。
    ///
    /// 实现放在这里而不是界面上：导入的口径只该有一处，
    /// 否则「粘贴导入」与「文件导入」迟早会不一致。
    pub fn import_into(&mut self, id: &str, text: &str) -> Result<usize, String> {
        let list = self
            .lists
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("找不到术语表 {id}"))?;
        let entries = glossary::parse_delimited(text);
        if entries.is_empty() {
            // 空结果多半是格式不对。静默清空已有的条目是最糟的失败方式。
            return Err("没解析出任何术语，请检查是否为「原文,译文」两列".to_string());
        }
        // 设置页的「保存」也走这里（整张表转 CSV 再导入）：同一原文的条目带上原来的
        // 未知字段，否则用户在界面里改一次术语表，新版本写在条目上的字段就没了。
        let mut entries = entries;
        for entry in &mut entries {
            if let Some(old) = list.entries.iter().find(|old| old.source == entry.source) {
                entry.extra = old.extra.clone();
            }
        }
        let count = entries.len();
        list.entries = entries;
        Ok(count)
    }

    /// 为一次翻译准备要注入的术语块（PRD §5.8）。
    ///
    /// 三件事，缺一不可：
    ///
    /// 1. **按语言对筛选**：不同语言对的表不该互相干扰。
    /// 2. **只取命中的术语**：整表注入会让每次请求多花几千 token，
    ///    用户会在账单上看到这笔钱却不知道来由。
    /// 3. **跨表去重**：同一个词可能同时出现在「通用表」与「公司术语表」里，
    ///    两条都注入会让模型收到互相矛盾的两条规则。**先出现的表优先**，
    ///    顺序就是用户在设置页看到的顺序——把更具体的表排在前面即可。
    ///
    /// 没有命中时返回 `None`，调用方据此跳过注入（`{glossary}` 段也不会写进 Prompt）。
    pub fn block_for(
        lists: &[Glossary],
        source_lang: Option<&str>,
        target_lang: &str,
        text: &str,
    ) -> Option<String> {
        let mut hits: Vec<&GlossaryEntry> = Vec::new();
        let mut seen: Vec<String> = Vec::new();

        for list in lists {
            if !glossary::applies_to(list, source_lang, target_lang) {
                continue;
            }
            for entry in glossary::matches(list, text) {
                let key = entry.source.to_lowercase();
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key);
                hits.push(entry);
            }
        }

        glossary::render_block(hits)
    }

    /// 导出某张表为 CSV。
    pub fn export(&self, id: &str) -> Result<String, String> {
        self.lists
            .iter()
            .find(|item| item.id == id)
            .map(|list| glossary::to_csv(&list.entries))
            .ok_or_else(|| format!("找不到术语表 {id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use umuo_core::glossary::{parse_delimited, GlossaryEntry};

    #[test]
    fn unknown_fields_in_the_glossary_file_survive_load_and_save() {
        // 新版本给术语表、单张表、单条术语加的字段，旧版本保存一次不能丢
        let dir = std::env::temp_dir().join("umuo-glossaries-test-unknown");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(GLOSSARIES_FILE),
            r#"{"lists":[{"id":"a","name":"A","futureTag":"x",
                "entries":[{"source":"umuo","target":"umuo","futureNote":"品牌名"}]}],
              "futureTop":1}"#,
        )
        .unwrap();
        Glossaries::load(&dir).save(&dir).unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(GLOSSARIES_FILE)).unwrap())
                .unwrap();
        assert_eq!(saved["futureTop"], 1);
        assert_eq!(saved["lists"][0]["futureTag"], "x");
        assert_eq!(saved["lists"][0]["entries"][0]["futureNote"], "品牌名");
    }

    #[test]
    fn saving_a_list_from_the_editor_keeps_unknown_fields_of_unchanged_terms() {
        // 设置页的「保存」把整张表转成 CSV 再导入：同一原文的条目要带上原来的未知字段
        let mut glossaries = Glossaries::default();
        let mut kept = list("a");
        kept.entries = parse_delimited("umuo,umuo\nold,旧");
        kept.entries[0]
            .extra
            .insert("futureNote".into(), "品牌名".into());
        glossaries.upsert(kept);

        glossaries.import_into("a", "umuo,umuo\nnew,新").unwrap();
        let entries = &glossaries.lists[0].entries;
        assert_eq!(entries[0].extra["futureNote"], "品牌名");
        assert!(entries[1].extra.is_empty());
    }

    fn list(id: &str) -> Glossary {
        Glossary {
            extra: Default::default(),
            id: id.to_string(),
            name: id.to_string(),
            source_lang: String::new(),
            target_lang: String::new(),
            entries: vec![GlossaryEntry {
                extra: Default::default(),
                source: "Transformer".to_string(),
                target: "变换器".to_string(),
            }],
        }
    }

    #[test]
    fn upsert_replaces_by_id_instead_of_appending_a_duplicate() {
        let mut store = Glossaries::default();
        store.upsert(list("a"));
        store.upsert(list("a"));
        assert_eq!(store.lists.len(), 1, "同一个 id 不该出现两条");

        store.upsert(list("b"));
        assert_eq!(store.lists.len(), 2);
    }

    #[test]
    fn remove_reports_whether_anything_went_away() {
        let mut store = Glossaries::default();
        store.upsert(list("a"));
        assert!(store.remove("a"));
        assert!(!store.remove("a"), "重复删除返回 false 而不是报错");
    }

    #[test]
    fn importing_replaces_the_entries_of_that_list_only() {
        let mut store = Glossaries::default();
        store.upsert(list("a"));
        store.upsert(list("b"));

        let count = store
            .import_into("a", "原文,译文\nPrompt,提示词\nToken,词元\n")
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(store.lists[0].entries.len(), 2);
        assert_eq!(store.lists[1].entries.len(), 1, "另一张表不该被动到");
    }

    #[test]
    fn importing_something_unparseable_is_an_error_not_a_silent_wipe() {
        // 静默清空已有条目是最糟的失败方式：用户会以为导入成功了。
        let mut store = Glossaries::default();
        store.upsert(list("a"));
        let error = store
            .import_into("a", "这一行没有任何分隔符\n")
            .unwrap_err();
        assert!(
            error.contains("原文,译文"),
            "错误里要说清期望的格式：{error}"
        );
        assert_eq!(store.lists[0].entries.len(), 1, "失败时不该改动已有条目");
    }

    #[test]
    fn importing_into_a_missing_list_is_an_error() {
        let mut store = Glossaries::default();
        assert!(store.import_into("nope", "a,b\n").is_err());
    }

    #[test]
    fn export_then_import_returns_the_same_entries() {
        let mut store = Glossaries::default();
        store.upsert(list("a"));
        let csv = store.export("a").unwrap();
        store.lists[0].entries.clear();
        store.import_into("a", &csv).unwrap();
        assert_eq!(store.lists[0].entries, list("a").entries);
    }

    #[test]
    fn exporting_a_missing_list_is_an_error() {
        let store = Glossaries::default();
        assert!(store.export("nope").is_err());
    }

    #[test]
    fn only_terms_that_actually_appear_are_injected() {
        // 整表注入会让每次请求多花几千 token，账单上看得出来但用户不知道为什么。
        let mut store = Glossaries::default();
        store.upsert(Glossary {
            extra: Default::default(),
            id: "tech".to_string(),
            name: "技术".to_string(),
            source_lang: "en".to_string(),
            target_lang: "zh-CN".to_string(),
            entries: parse_delimited("Transformer,变换器\nKubernetes,K8s\n"),
        });

        let block =
            Glossaries::block_for(&store.lists, Some("en"), "zh-CN", "The Transformer model")
                .expect("应当命中一条");
        assert!(block.contains("Transformer"));
        assert!(!block.contains("Kubernetes"), "没出现的术语不该被注入");
    }

    #[test]
    fn a_glossary_for_another_language_pair_is_skipped() {
        let mut store = Glossaries::default();
        store.upsert(Glossary {
            extra: Default::default(),
            id: "en-zh".to_string(),
            name: "英中".to_string(),
            source_lang: "en".to_string(),
            target_lang: "zh-CN".to_string(),
            entries: parse_delimited("Transformer,变换器\n"),
        });
        assert!(
            Glossaries::block_for(&store.lists, Some("ja"), "zh-CN", "Transformer").is_none(),
            "日语原文不该用英中的表"
        );
    }

    #[test]
    fn nothing_matched_means_no_block_at_all() {
        let mut store = Glossaries::default();
        store.upsert(list("a"));
        assert!(Glossaries::block_for(&store.lists, None, "zh-CN", "完全不相关的文本").is_none());
    }

    #[test]
    fn a_term_defined_in_two_lists_is_injected_once_and_the_first_list_wins() {
        // 两条都注入会让模型收到互相矛盾的规则。
        let mut store = Glossaries::default();
        store.upsert(Glossary {
            extra: Default::default(),
            id: "general".to_string(),
            name: "通用".to_string(),
            source_lang: String::new(),
            target_lang: String::new(),
            entries: vec![GlossaryEntry {
                extra: Default::default(),
                source: "Transformer".to_string(),
                target: "变换器".to_string(),
            }],
        });
        store.upsert(Glossary {
            extra: Default::default(),
            id: "company".to_string(),
            name: "公司".to_string(),
            source_lang: String::new(),
            target_lang: String::new(),
            entries: vec![GlossaryEntry {
                extra: Default::default(),
                source: "transformer".to_string(),
                target: "变压器".to_string(),
            }],
        });

        let block =
            Glossaries::block_for(&store.lists, Some("en"), "zh-CN", "Transformer").unwrap();
        assert!(block.contains("变换器"), "第一条命中应当优先：{block}");
        assert!(!block.contains("变压器"), "重复术语只该注入一次：{block}");
    }

    #[test]
    fn a_saved_file_loads_back_unchanged() {
        let dir = std::env::temp_dir().join("umuo-glossary-test");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = Glossaries::default();
        store.upsert(Glossary {
            extra: Default::default(),
            id: "tech".to_string(),
            name: "技术术语".to_string(),
            source_lang: "en".to_string(),
            target_lang: "zh-CN".to_string(),
            entries: parse_delimited("Transformer,变换器\nToken,词元\n"),
        });
        store.save(&dir).unwrap();
        assert_eq!(Glossaries::load(&dir), store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_file_is_backed_up_and_the_app_still_starts() {
        // 与 settings.json 同一套容错：手改坏了不该让客户端起不来。
        let dir = std::env::temp_dir().join("umuo-glossary-corrupt");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(GLOSSARIES_FILE), "{ 这不是 JSON").unwrap();

        let store = Glossaries::load(&dir);
        assert!(store.lists.is_empty());
        assert_eq!(
            crate::persist::corrupt_backups(&dir, GLOSSARIES_FILE).len(),
            1,
            "解析失败的文件应当被备份而不是丢弃"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
