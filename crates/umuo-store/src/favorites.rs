//! 收藏（PRD §5.9：单词与句子）。
//!
//! 与历史的区别是**用户显式标记**的，所以它不参与「保留天数」清理——
//! 用户不会希望「三个月前收藏的那个词」被自动删掉。
//! 清理只作用于历史，这条边界值得写下来。

use serde::{Deserialize, Serialize};

use crate::error::StoreError;
use crate::Store;

/// 收藏的类型。单词与句子分开，因为将来「单词卡」与「句子跟读」会走不同的入口。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteKind {
    Word,
    Sentence,
}

impl FavoriteKind {
    fn as_str(self) -> &'static str {
        match self {
            FavoriteKind::Word => "word",
            FavoriteKind::Sentence => "sentence",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "word" => Some(FavoriteKind::Word),
            "sentence" => Some(FavoriteKind::Sentence),
            _ => None,
        }
    }
}

/// 一条新收藏。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFavorite {
    pub created_at: i64,
    pub kind: FavoriteKind,
    pub text: String,
    pub translation: Option<String>,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

/// 一条已存在的收藏。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: i64,
    pub created_at: i64,
    pub kind: FavoriteKind,
    pub text: String,
    pub translation: Option<String>,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

const COLUMNS: &str = "id, created_at, kind, text, translation, source_lang, target_lang";

fn row_to_favorite(row: &rusqlite::Row<'_>) -> rusqlite::Result<Favorite> {
    let kind: String = row.get(2)?;
    Ok(Favorite {
        id: row.get(0)?,
        created_at: row.get(1)?,
        // 库里出现未知 kind 时回落成「句子」而不是报错：收藏列表少一个分类标签，
        // 总好过整张列表因为一条脏数据打不开。
        kind: FavoriteKind::parse(&kind).unwrap_or(FavoriteKind::Sentence),
        text: row.get(3)?,
        translation: row.get(4)?,
        source_lang: row.get(5)?,
        target_lang: row.get(6)?,
    })
}

impl Store {
    /// 记一条收藏。同一条内容重复收藏时**不报错、不产生第二行**，返回已有那条的 id。
    ///
    /// 表上有 `UNIQUE(kind, text)`：用户连点两下收藏是很常见的事，
    /// 让它报错或塞进两条重复记录都不对。
    pub fn add_favorite(&self, favorite: &NewFavorite) -> Result<i64, StoreError> {
        self.connection().execute(
            "INSERT INTO favorites (created_at, kind, text, translation, source_lang, target_lang)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(kind, text) DO NOTHING",
            rusqlite::params![
                favorite.created_at,
                favorite.kind.as_str(),
                favorite.text,
                favorite.translation,
                favorite.source_lang,
                favorite.target_lang,
            ],
        )?;

        Ok(self.connection().query_row(
            "SELECT id FROM favorites WHERE kind = ?1 AND text = ?2",
            rusqlite::params![favorite.kind.as_str(), favorite.text],
            |row| row.get(0),
        )?)
    }

    pub fn remove_favorite(&self, id: i64) -> Result<bool, StoreError> {
        let affected = self
            .connection()
            .execute("DELETE FROM favorites WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    /// 按内容取消收藏。历史列表里的「取消收藏」用它——那边只有文本，没有收藏 id。
    pub fn remove_favorite_by_text(
        &self,
        kind: FavoriteKind,
        text: &str,
    ) -> Result<bool, StoreError> {
        let affected = self.connection().execute(
            "DELETE FROM favorites WHERE kind = ?1 AND text = ?2",
            rusqlite::params![kind.as_str(), text],
        )?;
        Ok(affected > 0)
    }

    /// 这条内容是否已被收藏。历史列表据此决定星标是实心还是空心。
    pub fn is_favorited(&self, kind: FavoriteKind, text: &str) -> Result<bool, StoreError> {
        Ok(self.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM favorites WHERE kind = ?1 AND text = ?2)",
            rusqlite::params![kind.as_str(), text],
            |row| row.get::<_, i64>(0),
        )? != 0)
    }

    pub fn favorites(&self, limit: u32, offset: u32) -> Result<Vec<Favorite>, StoreError> {
        let sql = format!("SELECT {COLUMNS} FROM favorites ORDER BY id DESC LIMIT ?1 OFFSET ?2");
        let mut stmt = self.connection().prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params![limit, offset], row_to_favorite)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn favorite_count(&self) -> Result<u32, StoreError> {
        Ok(self
            .connection()
            .query_row("SELECT COUNT(*) FROM favorites", [], |row| row.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn favorite(text: &str, created_at: i64) -> NewFavorite {
        NewFavorite {
            created_at,
            kind: FavoriteKind::Word,
            text: text.to_string(),
            translation: Some("词义".to_string()),
            source_lang: Some("en".to_string()),
            target_lang: Some("zh-CN".to_string()),
        }
    }

    #[test]
    fn adding_then_listing_round_trips() {
        let store = Store::open_in_memory().unwrap();
        let id = store.add_favorite(&favorite("hello", 100)).unwrap();
        let list = store.favorites(10, 0).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);
        assert_eq!(list[0].text, "hello");
        assert_eq!(list[0].kind, FavoriteKind::Word);
        assert_eq!(list[0].translation.as_deref(), Some("词义"));
    }

    #[test]
    fn favoriting_the_same_text_twice_does_not_create_a_duplicate() {
        // 用户连点两下收藏很常见：既不该报错，也不该产生两行。
        let store = Store::open_in_memory().unwrap();
        let first = store.add_favorite(&favorite("hello", 100)).unwrap();
        let second = store.add_favorite(&favorite("hello", 200)).unwrap();
        assert_eq!(first, second, "重复收藏应返回同一条的 id");
        assert_eq!(store.favorite_count().unwrap(), 1);
    }

    #[test]
    fn the_same_text_can_be_favorited_as_both_a_word_and_a_sentence() {
        // 唯一约束是 (kind, text) 而不是 text：同一个词与包含它的句子是两条收藏。
        let store = Store::open_in_memory().unwrap();
        store.add_favorite(&favorite("hello", 100)).unwrap();
        store
            .add_favorite(&NewFavorite {
                kind: FavoriteKind::Sentence,
                ..favorite("hello", 200)
            })
            .unwrap();
        assert_eq!(store.favorite_count().unwrap(), 2);
    }

    #[test]
    fn is_favorited_reflects_the_current_state() {
        let store = Store::open_in_memory().unwrap();
        assert!(!store.is_favorited(FavoriteKind::Word, "hello").unwrap());
        store.add_favorite(&favorite("hello", 100)).unwrap();
        assert!(store.is_favorited(FavoriteKind::Word, "hello").unwrap());
        assert!(
            !store.is_favorited(FavoriteKind::Sentence, "hello").unwrap(),
            "类型不同不算收藏"
        );
    }

    #[test]
    fn removing_works_by_id_and_by_text() {
        let store = Store::open_in_memory().unwrap();
        let id = store.add_favorite(&favorite("a", 1)).unwrap();
        store.add_favorite(&favorite("b", 2)).unwrap();

        assert!(store.remove_favorite(id).unwrap());
        assert!(
            !store.remove_favorite(id).unwrap(),
            "重复删除返回 false 而不是报错"
        );
        assert!(store
            .remove_favorite_by_text(FavoriteKind::Word, "b")
            .unwrap());
        assert_eq!(store.favorite_count().unwrap(), 0);
    }

    #[test]
    fn favorites_are_not_touched_by_history_pruning() {
        // 收藏是用户显式标记的，不该被「保留 90 天」这类清理顺手删掉。
        let store = Store::open_in_memory().unwrap();
        store.add_favorite(&favorite("keep me", 100)).unwrap();
        store.prune_before(i64::MAX).unwrap();
        assert_eq!(store.favorite_count().unwrap(), 1);
    }

    #[test]
    fn list_is_newest_first_and_pages() {
        let store = Store::open_in_memory().unwrap();
        for i in 0..5 {
            store.add_favorite(&favorite(&format!("w{i}"), i)).unwrap();
        }
        let first = store.favorites(2, 0).unwrap();
        assert_eq!(first[0].text, "w4");
        assert_eq!(store.favorites(2, 2).unwrap()[0].text, "w2");
    }

    #[test]
    fn an_unknown_kind_in_the_database_does_not_break_the_list() {
        // 脏数据（手改库、或以后新增了 kind 又回退版本）不该让整张收藏列表打不开。
        let store = Store::open_in_memory().unwrap();
        store.add_favorite(&favorite("ok", 1)).unwrap();
        store
            .connection()
            .execute(
                "INSERT INTO favorites (created_at, kind, text) VALUES (2, 'mystery', 'legacy')",
                [],
            )
            .unwrap();

        let list = store.favorites(10, 0).unwrap();
        assert_eq!(list.len(), 2, "未知 kind 的那条仍应列出来");
    }
}
