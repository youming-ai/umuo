//! 翻译历史。
//!
//! 用量账本（`usage` 表）已停写：表与 v2 迁移原样保留、旧数据不删，这里不再提供它的读写函数。

use serde::{Deserialize, Serialize};

use crate::error::StoreError;
use crate::Store;

/// 写入一条历史所需的全部字段。
///
/// 与 [`Record`] 分开：`id` 是数据库给的，调用方在写入前不可能知道它。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRecord {
    /// Unix 秒。由调用方给，便于测试与「按当时的时间」记录。
    pub created_at: i64,
    pub source_text: String,
    pub translated_text: String,
    pub source_lang: Option<String>,
    pub target_lang: String,
    pub provider_id: String,
    pub model: String,
    pub style_id: String,
    /// 场景标签（selection / silentReplace / compose / ocr / voice；旧库里还可能有 compare），
    /// 让用户能看出「这条是划词来的还是撰写窗来的」。
    pub scene: String,
    /// 来源应用名。拿不到时为 `None`——**不填一个假的占位符**。
    pub source_app: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// 用量是本地估算的（厂商没回 usage）。
    pub estimated: bool,
    /// 价格表里查不到该模型时为 `None`。
    pub cost_usd: Option<f64>,
}

/// 一条历史记录。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: i64,
    #[serde(flatten)]
    pub entry: NewRecord,
}

const COLUMNS: &str = "id, created_at, source_text, translated_text, source_lang, target_lang, \
     provider_id, model, style_id, scene, source_app, input_tokens, output_tokens, estimated, cost_usd";

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<Record> {
    Ok(Record {
        id: row.get(0)?,
        entry: NewRecord {
            created_at: row.get(1)?,
            source_text: row.get(2)?,
            translated_text: row.get(3)?,
            source_lang: row.get(4)?,
            target_lang: row.get(5)?,
            provider_id: row.get(6)?,
            model: row.get(7)?,
            style_id: row.get(8)?,
            scene: row.get(9)?,
            source_app: row.get(10)?,
            input_tokens: row.get(11)?,
            output_tokens: row.get(12)?,
            estimated: row.get::<_, i64>(13)? != 0,
            cost_usd: row.get(14)?,
        },
    })
}

impl Store {
    /// 追加一条历史，返回它的 id。
    pub fn insert(&self, record: &NewRecord) -> Result<i64, StoreError> {
        self.connection().execute(
            "INSERT INTO history (created_at, source_text, translated_text, source_lang,
             target_lang, provider_id, model, style_id, scene, source_app,
             input_tokens, output_tokens, estimated, cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                record.created_at,
                record.source_text,
                record.translated_text,
                record.source_lang,
                record.target_lang,
                record.provider_id,
                record.model,
                record.style_id,
                record.scene,
                record.source_app,
                record.input_tokens,
                record.output_tokens,
                record.estimated as i64,
                record.cost_usd,
            ],
        )?;
        Ok(self.connection().last_insert_rowid())
    }

    /// 最近的记录，最新的在前。
    pub fn recent(&self, limit: u32, offset: u32) -> Result<Vec<Record>, StoreError> {
        self.query(&HistoryFilter::default(), limit, offset)
    }

    /// 按关键词检索历史（PRD §5.9），新的在前；空条件等于 [`Self::recent`]。
    ///
    /// 原文与译文任一命中即可。通配符要转义——用户搜 `100%` 时，`%` 是 SQL 的通配符，
    /// 不转义会变成「匹配任何内容」，结果看起来像「搜索失效」。
    /// 每个值都走占位符，**不做字符串插值**。
    pub fn query(
        &self,
        filter: &HistoryFilter,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Record>, StoreError> {
        let mut clauses: Vec<&str> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(needle) = filter
            .query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
        {
            clauses.push("(source_text LIKE ? ESCAPE '\\' OR translated_text LIKE ? ESCAPE '\\')");
            let pattern = format!("%{}%", escape_like(needle));
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }

        let mut sql = format!("SELECT {COLUMNS} FROM history");
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY id DESC LIMIT ? OFFSET ?");
        params.push(Box::new(limit));
        params.push(Box::new(offset));

        let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = self.connection().prepare(&sql)?;
        let rows = stmt.query_map(refs.as_slice(), row_to_record)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn delete(&self, id: i64) -> Result<bool, StoreError> {
        let affected = self
            .connection()
            .execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    /// 清空全部历史，返回删除的条数。用量账本不受影响——清历史不等于把钱退回来。
    pub fn clear(&self) -> Result<usize, StoreError> {
        Ok(self.connection().execute("DELETE FROM history", [])?)
    }

    pub fn count(&self) -> Result<u32, StoreError> {
        Ok(self
            .connection()
            .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))?)
    }

    /// 删除 `before`（不含）之前的记录，返回删除条数。
    ///
    /// 保留策略用它（PRD §5.9「可设置保留天数，默认 90 天」）。
    /// 用「不含」而不是「含」是为了让语义与 `created_at < before` 一致，
    /// 调用方自己算好边界时间即可。只删历史，用量账本不受保留期影响。
    pub fn prune_before(&self, before: i64) -> Result<usize, StoreError> {
        Ok(self
            .connection()
            .execute("DELETE FROM history WHERE created_at < ?1", [before])?)
    }
}

/// 历史检索条件（PRD §5.9）：只有关键词。来源 App / 模型筛选已退出，`source_app` 与 `model` 列照常写入。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HistoryFilter {
    /// 子串检索，命中原文或译文任一即可。
    pub query: Option<String>,
}

/// 转义 LIKE 的通配符。
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(source: &str, translated: &str, created_at: i64) -> NewRecord {
        NewRecord {
            created_at,
            source_text: source.to_string(),
            translated_text: translated.to_string(),
            source_lang: Some("en".to_string()),
            target_lang: "zh-CN".to_string(),
            provider_id: "openai".to_string(),
            model: "gpt-4o-mini".to_string(),
            style_id: "standard".to_string(),
            scene: "selection".to_string(),
            source_app: Some("Safari".to_string()),
            input_tokens: 100,
            output_tokens: 40,
            estimated: false,
            cost_usd: Some(0.0001),
        }
    }

    fn search(store: &Store, query: &str) -> Vec<Record> {
        store
            .query(
                &HistoryFilter {
                    query: Some(query.to_string()),
                },
                10,
                0,
            )
            .unwrap()
    }

    #[test]
    fn insert_then_read_back_preserves_every_field() {
        let store = Store::open_in_memory().unwrap();
        let record = sample("Hello", "你好", 1_700_000_000);
        let id = store.insert(&record).unwrap();

        let rows = store.recent(10, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].entry, record);
    }

    #[test]
    fn recent_returns_newest_first_and_pages() {
        let store = Store::open_in_memory().unwrap();
        for i in 0..5 {
            store
                .insert(&sample(&format!("s{i}"), "译", 1_700_000_000 + i))
                .unwrap();
        }
        let first = store.recent(2, 0).unwrap();
        assert_eq!(first[0].entry.source_text, "s4", "最新的在最前");
        let second = store.recent(2, 2).unwrap();
        assert_eq!(second[0].entry.source_text, "s2");
    }

    #[test]
    fn search_hits_both_the_source_and_the_translation() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&sample("transformer model", "变换器模型", 1))
            .unwrap();
        store.insert(&sample("hello world", "你好世界", 2)).unwrap();

        assert_eq!(search(&store, "transformer").len(), 1);
        assert_eq!(search(&store, "你好").len(), 1);
        assert!(search(&store, "不存在的内容").is_empty());
    }

    #[test]
    fn search_treats_percent_and_underscore_as_literals() {
        // 不转义的话 `%` 会变成「匹配任何内容」，用户看到的是「搜什么都返回全部」。
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&sample("折扣 100% 起", "up to 100% off", 1))
            .unwrap();
        store
            .insert(&sample("完全无关的一句", "unrelated", 2))
            .unwrap();

        assert_eq!(search(&store, "100%").len(), 1, "`%` 应被当作字面量");
        assert_eq!(search(&store, "_").len(), 0, "`_` 同理");
    }

    #[test]
    fn delete_reports_whether_anything_was_removed() {
        let store = Store::open_in_memory().unwrap();
        let id = store.insert(&sample("a", "b", 1)).unwrap();
        assert!(store.delete(id).unwrap());
        assert!(
            !store.delete(id).unwrap(),
            "重复删除应返回 false 而不是报错"
        );
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn clear_removes_everything() {
        let store = Store::open_in_memory().unwrap();
        for i in 0..3 {
            store.insert(&sample("a", "b", i)).unwrap();
        }
        assert_eq!(store.clear().unwrap(), 3);
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn prune_removes_only_records_older_than_the_cutoff() {
        let store = Store::open_in_memory().unwrap();
        store.insert(&sample("old", "旧", 100)).unwrap();
        store.insert(&sample("edge", "边界", 200)).unwrap();
        store.insert(&sample("new", "新", 300)).unwrap();

        // 边界时间本身要保留：语义是「早于 cutoff 的删掉」。
        assert_eq!(store.prune_before(200).unwrap(), 1);
        let remaining: Vec<String> = store
            .recent(10, 0)
            .unwrap()
            .into_iter()
            .map(|r| r.entry.source_text)
            .collect();
        assert_eq!(remaining, vec!["new", "edge"]);
    }

    #[test]
    fn an_empty_filter_behaves_exactly_like_recent() {
        // 回归保护：筛选引入之后，「不加条件」的语义不能变。
        let store = Store::open_in_memory().unwrap();
        for i in 0..3 {
            store
                .insert(&sample(&format!("s{i}"), "译", 1_700_000_000))
                .unwrap();
        }
        assert_eq!(
            store.query(&HistoryFilter::default(), 50, 0).unwrap(),
            store.recent(50, 0).unwrap()
        );
    }

    #[test]
    fn a_blank_query_is_treated_as_absent() {
        // 搜索框清空后可能传空白，不该被当成「匹配空白」而筛掉一切。
        let store = Store::open_in_memory().unwrap();
        store.insert(&sample("a", "甲", 1)).unwrap();
        assert_eq!(search(&store, "   ").len(), 1);
    }

    #[test]
    fn clearing_and_pruning_history_never_touch_old_favorites_or_usage_rows() {
        // 收藏与用量账本都已退出界面，但旧数据原样留在库里，不随历史清理一起消失。
        let store = Store::open_in_memory().unwrap();
        let conn = store.connection();
        conn.execute(
            "INSERT INTO favorites (created_at, kind, text) VALUES (1, 'word', 'hello')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO usage (created_at, provider_id, model, input_tokens, output_tokens,
             estimated, cost_usd) VALUES (1, 'openai', 'm', 1, 1, 0, NULL)",
            [],
        )
        .unwrap();
        store.insert(&sample("a", "甲", 1)).unwrap();

        store.prune_before(i64::MAX).unwrap();
        store.clear().unwrap();
        let rows = |table: &str| -> u32 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
        };
        assert_eq!(rows("favorites"), 1);
        assert_eq!(rows("usage"), 1);
    }
}
