//! 翻译历史与用量统计。

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
    /// 场景标签（selection / silentReplace / compose / compare），
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

/// 一段时间的用量汇总（PRD §5.10）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// 价格未知的那些记录不计入，但它们的条数在 `unpriced` 里如实给出——
    /// 否则用户会以为「这个月只花了这么点」，而实际有一部分根本没算进去。
    pub cost_usd: f64,
    pub unpriced: u32,
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

    /// 按条件检索历史（PRD §5.9：全文检索 + 按来源 App / 模型筛选）。
    ///
    /// 三个条件是 **AND** 关系，可以任意叠加——「在 Slack 里、用 gpt-4o 翻过、
    /// 且包含这个词的记录」是一个真实会有的问题。
    ///
    /// 动态拼 WHERE 而不是写六个分支：分支数会随条件数指数增长。
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
        if let Some(app) = filter.source_app.as_deref().filter(|v| !v.is_empty()) {
            clauses.push("source_app = ?");
            params.push(Box::new(app.to_string()));
        }
        if let Some(model) = filter.model.as_deref().filter(|v| !v.is_empty()) {
            clauses.push("model = ?");
            params.push(Box::new(model.to_string()));
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

    /// 供筛选下拉用的取值集合（历史里真正出现过的来源 App 与模型）。
    ///
    /// 从数据里取而不是从供应商目录取：目录里有十几家，但这个用户可能只用过两家——
    /// 给他一堆选了没结果的选项，比不给筛选更烦。
    pub fn facets(&self) -> Result<Facets, StoreError> {
        let collect = |sql: &str| -> Result<Vec<String>, StoreError> {
            let mut stmt = self.connection().prepare(sql)?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        };
        Ok(Facets {
            apps: collect(
                "SELECT DISTINCT source_app FROM history
                 WHERE source_app IS NOT NULL AND source_app <> '' ORDER BY source_app",
            )?,
            models: collect("SELECT DISTINCT model FROM history WHERE model <> '' ORDER BY model")?,
        })
    }

    /// 子串检索：原文与译文任一命中即可。
    ///
    /// 通配符要转义——用户搜 `100%` 时，`%` 是 SQL 的通配符，
    /// 不转义会变成「匹配任何内容」，结果看起来像「搜索失效」。
    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<Record>, StoreError> {
        // 与 `query` 走同一条实现：两套 SQL 迟早会在转义或排序上分叉。
        self.query(
            &HistoryFilter {
                query: Some(query.to_string()),
                ..HistoryFilter::default()
            },
            limit,
            0,
        )
    }

    pub fn delete(&self, id: i64) -> Result<bool, StoreError> {
        let affected = self
            .connection()
            .execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    /// 清空全部历史，返回删除的条数。
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
    /// 调用方自己算好边界时间即可。
    pub fn prune_before(&self, before: i64) -> Result<usize, StoreError> {
        Ok(self
            .connection()
            .execute("DELETE FROM history WHERE created_at < ?1", [before])?)
    }

    /// 统计 `since`（含）之后的用量与费用。
    pub fn usage_since(&self, since: i64) -> Result<UsageSummary, StoreError> {
        let summary = self.connection().query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cost_usd), 0.0),
                    COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0)
             FROM history WHERE created_at >= ?1",
            [since],
            |row| {
                Ok(UsageSummary {
                    count: row.get(0)?,
                    input_tokens: row.get(1)?,
                    output_tokens: row.get(2)?,
                    cost_usd: row.get(3)?,
                    unpriced: row.get(4)?,
                })
            },
        )?;
        Ok(summary)
    }

    /// 本地时区下「本月」的起点（Unix 秒）。
    ///
    /// 交给 SQLite 算而不是自己算：`localtime` 与 `start of month` 都是它自带的修饰符，
    /// 手写这套日期算术需要引一个日期库，而且要自己处理时区——为了一个展示用的月份
    /// 边界不值得，还容易在月末出错。
    ///
    /// **末尾那个 `'utc'` 不能省。** `datetime('now','localtime','start of month')`
    /// 产出的是「本地日历上的一个字符串」，而 `strftime('%s', …)` 会把它按 **UTC** 解释，
    /// 结果整整偏掉一个时区偏移（东九区就是 9 小时，实测出来是 09:00 而不是 00:00）。
    /// 再补一个 `'utc'` 才是「把这个本地时刻换算回真正的瞬时」。
    /// 少写它，每月头几个小时会被算成上个月。
    pub fn month_start_unix(&self) -> Result<i64, StoreError> {
        Ok(self.connection().query_row(
            "SELECT CAST(strftime('%s', datetime('now', 'localtime', 'start of month', 'utc')) AS INTEGER)",
            [],
            |row| row.get(0),
        )?)
    }

    /// 按供应商汇总某段时间的用量。
    ///
    /// 月度上限是**按供应商**算的（PRD §5.10），所以这个聚合是那条规则的数据来源。
    pub fn usage_by_provider(&self, since: i64) -> Result<Vec<ProviderUsage>, StoreError> {
        let mut stmt = self.connection().prepare(
            "SELECT provider_id,
                    COUNT(*),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cost_usd), 0.0),
                    COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0)
             FROM history WHERE created_at >= ?1
             GROUP BY provider_id ORDER BY provider_id",
        )?;
        let rows = stmt.query_map([since], |row| {
            Ok(ProviderUsage {
                provider_id: row.get(0)?,
                count: row.get(1)?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
                cost_usd: row.get(4)?,
                unpriced: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// 某个供应商在本月的花费。没记录时是 0。
    pub fn provider_spend_this_month(&self, provider_id: &str) -> Result<f64, StoreError> {
        let since = self.month_start_unix()?;
        Ok(self.connection().query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM history
             WHERE created_at >= ?1 AND provider_id = ?2",
            rusqlite::params![since, provider_id],
            |row| row.get(0),
        )?)
    }

    /// 本月的用量与费用（PRD §5.10「按日 / 月展示费用」）。
    pub fn usage_this_month(&self) -> Result<UsageSummary, StoreError> {
        let since = self.month_start_unix()?;
        self.usage_since(since)
    }

    /// 按天分组的用量（PRD §5.10 的「按日展示」）。
    ///
    /// 日期用 SQLite 的 `date(created_at,'unixepoch','localtime')` 算，
    /// 与应用层的本地日历口径一致——否则「按日」的桶边界会和「本月」对不上。
    ///
    /// **只返回有记录的那些天**，不补齐空白天：补零本该由展示层决定
    /// （要不要显示 0 的那一天是 UI 的事），而这里返回一个「真实有哪些天」的列表，
    /// 语义更诚实。
    pub fn usage_by_day(&self, since: i64) -> Result<Vec<DayUsage>, StoreError> {
        let mut stmt = self.connection().prepare(
            "SELECT date(created_at, 'unixepoch', 'localtime') AS day,
                    COUNT(*),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cost_usd), 0.0),
                    COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0)
             FROM history WHERE created_at >= ?1
             GROUP BY day ORDER BY day DESC",
        )?;
        let rows = stmt.query_map([since], |row| {
            Ok(DayUsage {
                day: row.get(0)?,
                count: row.get(1)?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
                cost_usd: row.get(4)?,
                unpriced: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

/// 历史检索条件（PRD §5.9）。三者可叠加，都是 AND。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HistoryFilter {
    /// 子串检索，命中原文或译文任一即可。
    pub query: Option<String>,
    /// 来源 App 精确匹配。
    pub source_app: Option<String>,
    /// 模型精确匹配。
    pub model: Option<String>,
}

/// 筛选下拉的取值集合。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub apps: Vec<String>,
    pub models: Vec<String>,
}

/// 某个供应商在某段时间内的用量（PRD §5.10 的月度上限按它判断）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub provider_id: String,
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    /// 价格未知、未计入总额的条数。
    pub unpriced: u32,
}

/// 某一天的用量。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    /// 本地日期，`YYYY-MM-DD`。
    pub day: String,
    pub count: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    /// 价格未知、未计入总额的条数。
    pub unpriced: u32,
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

        assert_eq!(store.search("transformer", 10).unwrap().len(), 1);
        assert_eq!(store.search("你好", 10).unwrap().len(), 1);
        assert!(store.search("不存在的内容", 10).unwrap().is_empty());
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

        let hits = store.search("100%", 10).unwrap();
        assert_eq!(hits.len(), 1, "`%` 应被当作字面量");
        assert_eq!(store.search("_", 10).unwrap().len(), 0, "`_` 同理");
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
    fn usage_aggregation_sums_tokens_and_cost_and_counts_unpriced_rows() {
        let store = Store::open_in_memory().unwrap();
        store.insert(&sample("a", "b", 100)).unwrap();
        let mut second = sample("c", "d", 200);
        second.input_tokens = 50;
        second.output_tokens = 10;
        second.cost_usd = Some(0.0002);
        store.insert(&second).unwrap();

        let mut unpriced = sample("e", "f", 300);
        unpriced.cost_usd = None;
        store.insert(&unpriced).unwrap();

        let summary = store.usage_since(0).unwrap();
        assert_eq!(summary.count, 3);
        assert_eq!(summary.input_tokens, 250);
        assert_eq!(summary.output_tokens, 90);
        assert!((summary.cost_usd - 0.0003).abs() < 1e-9);
        // 价格未知的条数要单独给出，否则用户会以为「这个月只花了这么点」。
        assert_eq!(summary.unpriced, 1);
    }

    #[test]
    fn usage_since_excludes_older_records() {
        let store = Store::open_in_memory().unwrap();
        store.insert(&sample("old", "旧", 100)).unwrap();
        store.insert(&sample("new", "新", 500)).unwrap();
        let summary = store.usage_since(400).unwrap();
        assert_eq!(summary.count, 1);
        assert_eq!(summary.input_tokens, 100);
    }

    #[test]
    fn an_empty_database_yields_a_zeroed_summary_rather_than_an_error() {
        // SUM() 在空表上返回 NULL；没兜住的话这里会直接报错，
        // 而「还没翻译过任何东西」是完全正常的状态。
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.usage_since(0).unwrap(), UsageSummary::default());
    }

    #[test]
    fn month_start_is_the_first_day_of_the_current_month_at_midnight() {
        let store = Store::open_in_memory().unwrap();
        let start = store.month_start_unix().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        assert!(start <= now, "月初不可能在未来");
        assert!(now - start < 31 * 86_400, "月初一定在最近 31 天内");
        // 起点应当是当地时间的 0 点。
        let hour: String = store
            .connection()
            .query_row(
                "SELECT strftime('%H', datetime(?1, 'unixepoch', 'localtime'))",
                [start],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hour, "00");
    }

    #[test]
    fn usage_this_month_ignores_records_from_before_the_month_started() {
        let store = Store::open_in_memory().unwrap();
        let month_start = store.month_start_unix().unwrap();

        // 上个月的最后一条：不该被算进本月。
        store
            .insert(&sample("old", "旧", month_start - 86_400))
            .unwrap();
        store.insert(&sample("new", "新", month_start)).unwrap();

        let summary = store.usage_this_month().unwrap();
        assert_eq!(summary.count, 1, "月初之前的不该计入本月");
        assert_eq!(summary.input_tokens, 100);
    }

    #[test]
    fn usage_by_day_groups_records_onto_their_local_date() {
        let store = Store::open_in_memory().unwrap();
        // 取一个已知的当天正午，确保同一本地日期下有两条。
        let noon = store
            .connection()
            .query_row(
                "SELECT CAST(strftime('%s', datetime('now','localtime','start of day','utc')) AS INTEGER) + 43200",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();

        store.insert(&sample("a", "甲", noon)).unwrap();
        store.insert(&sample("b", "乙", noon + 60)).unwrap();
        store.insert(&sample("c", "丙", noon - 86_400)).unwrap();

        let days = store.usage_by_day(0).unwrap();
        assert_eq!(days.len(), 2, "应该分成两天");
        assert_eq!(days[0].count, 2, "今天两条；最新的一天排在前面");
        assert_eq!(days[0].input_tokens, 200);
        assert_eq!(days[1].count, 1);
    }

    #[test]
    fn usage_by_day_reports_unpriced_rows_per_day() {
        // 某一天有未计价的记录时，那一天的总额同样是「不完整」的，必须能看出来。
        let store = Store::open_in_memory().unwrap();
        let mut unpriced = sample("e", "f", 1_700_000_000);
        unpriced.cost_usd = None;
        store.insert(&unpriced).unwrap();

        let days = store.usage_by_day(0).unwrap();
        assert_eq!(days[0].unpriced, 1);
        assert_eq!(days[0].day.len(), 10, "日期应为 YYYY-MM-DD");
    }

    fn record_with(app: &str, model: &str, source: &str, translated: &str) -> NewRecord {
        let mut record = sample(source, translated, 1_700_000_000);
        record.source_app = Some(app.to_string());
        record.model = model.to_string();
        record
    }

    #[test]
    fn filtering_by_source_app_narrows_the_list() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&record_with("Slack", "gpt-4o", "a", "甲"))
            .unwrap();
        store
            .insert(&record_with("Safari", "gpt-4o", "b", "乙"))
            .unwrap();

        let rows = store
            .query(
                &HistoryFilter {
                    source_app: Some("Slack".to_string()),
                    ..HistoryFilter::default()
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].entry.source_text, "a");
    }

    #[test]
    fn filtering_by_model_narrows_the_list() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&record_with("Slack", "gpt-4o", "a", "甲"))
            .unwrap();
        store
            .insert(&record_with("Slack", "deepseek-chat", "b", "乙"))
            .unwrap();

        let rows = store
            .query(
                &HistoryFilter {
                    model: Some("deepseek-chat".to_string()),
                    ..HistoryFilter::default()
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].entry.model, "deepseek-chat");
    }

    #[test]
    fn filters_combine_with_search_as_and_not_or() {
        // 「在 Slack 里、用 gpt-4o、且包含 token」是一个真实会有的问题；
        // 三个条件必须是 AND，否则结果会多到没法看。
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&record_with("Slack", "gpt-4o", "token limit", "词元上限"))
            .unwrap();
        store
            .insert(&record_with("Safari", "gpt-4o", "token limit", "词元上限"))
            .unwrap();
        store
            .insert(&record_with("Slack", "gpt-4o", "other", "别的"))
            .unwrap();

        let rows = store
            .query(
                &HistoryFilter {
                    query: Some("token".to_string()),
                    source_app: Some("Slack".to_string()),
                    model: Some("gpt-4o".to_string()),
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(rows.len(), 1, "三个条件应当同时满足：{rows:?}");
    }

    #[test]
    fn an_empty_filter_behaves_exactly_like_recent() {
        // 回归保护：筛选引入之后，「不加条件」的语义不能变。
        let store = Store::open_in_memory().unwrap();
        for i in 0..3 {
            store
                .insert(&record_with("Slack", "gpt-4o", &format!("s{i}"), "译"))
                .unwrap();
        }
        assert_eq!(
            store.query(&HistoryFilter::default(), 50, 0).unwrap(),
            store.recent(50, 0).unwrap()
        );
    }

    #[test]
    fn blank_filter_values_are_treated_as_absent() {
        // 界面上的下拉未选中时可能传空串，不该被当成「匹配空字符串」而筛掉一切。
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&record_with("Slack", "gpt-4o", "a", "甲"))
            .unwrap();

        let rows = store
            .query(
                &HistoryFilter {
                    query: Some("   ".to_string()),
                    source_app: Some(String::new()),
                    model: Some(String::new()),
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn facets_list_only_values_that_actually_appear() {
        // 给他一堆选了没结果的选项，比不给筛选更烦。
        let store = Store::open_in_memory().unwrap();
        store
            .insert(&record_with("Slack", "gpt-4o", "a", "甲"))
            .unwrap();
        store
            .insert(&record_with("Safari", "gpt-4o", "b", "乙"))
            .unwrap();
        store
            .insert(&record_with("Slack", "deepseek-chat", "c", "丙"))
            .unwrap();

        let facets = store.facets().unwrap();
        assert_eq!(facets.apps, vec!["Safari", "Slack"], "去重并按名排序");
        assert_eq!(facets.models, vec!["deepseek-chat", "gpt-4o"]);
    }

    #[test]
    fn facets_skip_missing_apps_and_blank_models() {
        let store = Store::open_in_memory().unwrap();
        let mut no_app = sample("a", "甲", 1_700_000_000);
        no_app.source_app = None;
        store.insert(&no_app).unwrap();

        let facets = store.facets().unwrap();
        assert!(
            facets.apps.is_empty(),
            "拿不到来源 App 时不该出现空字符串项"
        );
        assert_eq!(facets.models, vec![no_app.model.clone()]);
    }

    #[test]
    fn facets_on_an_empty_database_are_empty_lists() {
        let store = Store::open_in_memory().unwrap();
        let facets = store.facets().unwrap();
        assert!(facets.apps.is_empty() && facets.models.is_empty());
    }

    #[test]
    fn usage_is_grouped_per_provider() {
        // 月度上限是按供应商算的，所以这个聚合必须分得开。
        let store = Store::open_in_memory().unwrap();
        let mut first = sample("a", "甲", 1_700_000_000);
        first.provider_id = "openai".into();
        let mut second = sample("b", "乙", 1_700_000_100);
        second.provider_id = "openai".into();
        let mut third = sample("c", "丙", 1_700_000_200);
        third.provider_id = "deepseek".into();
        for record in [&first, &second, &third] {
            store.insert(record).unwrap();
        }

        let rows = store.usage_by_provider(0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].provider_id, "deepseek");
        assert_eq!(rows[1].provider_id, "openai");
        assert_eq!(rows[1].count, 2);
        assert_eq!(rows[1].input_tokens, 200);
    }

    #[test]
    fn a_provider_without_records_this_month_costs_zero() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.provider_spend_this_month("openai").unwrap(), 0.0);
    }

    #[test]
    fn provider_spend_this_month_ignores_other_providers_and_last_month() {
        let store = Store::open_in_memory().unwrap();
        let month_start = store.month_start_unix().unwrap();

        let mut this_month = sample("a", "甲", month_start);
        this_month.provider_id = "openai".into();
        this_month.cost_usd = Some(1.5);
        store.insert(&this_month).unwrap();

        let mut other = sample("b", "乙", month_start);
        other.provider_id = "deepseek".into();
        other.cost_usd = Some(99.0);
        store.insert(&other).unwrap();

        let mut last_month = sample("c", "丙", month_start - 86_400);
        last_month.provider_id = "openai".into();
        last_month.cost_usd = Some(50.0);
        store.insert(&last_month).unwrap();

        let spend = store.provider_spend_this_month("openai").unwrap();
        assert!(
            (spend - 1.5).abs() < 1e-9,
            "只该算本月本供应商，实际 {spend}"
        );
    }

    #[test]
    fn unpriced_requests_do_not_inflate_the_spend() {
        // 价格未知时 cost_usd 是 NULL，SUM 会跳过它。
        // 这正是我们要的：不能把未知当成 0，也不能让它变成某个数字。
        let store = Store::open_in_memory().unwrap();
        let mut record = sample("a", "甲", 1_700_000_000);
        record.cost_usd = None;
        store.insert(&record).unwrap();

        assert_eq!(
            store
                .provider_spend_this_month(&record.provider_id)
                .unwrap(),
            0.0
        );
        let rows = store.usage_by_provider(0).unwrap();
        assert_eq!(rows[0].unpriced, 1, "未计价的条数要能看出来");
    }

    #[test]
    fn usage_by_day_on_an_empty_database_is_an_empty_list_not_an_error() {
        let store = Store::open_in_memory().unwrap();
        assert!(store.usage_by_day(0).unwrap().is_empty());
    }
}
