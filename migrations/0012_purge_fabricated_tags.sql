-- The Poche pivot fabricated a topic tag out of the category: the feed carries
-- no <category> tags at all, so storeArticle wrote articles.category into
-- article_tags to keep it queryable there. The category already lives in
-- articles.category and every consumer reads it from the row, so the mirror
-- only duplicated information — the card rendered "Development · development"
-- and the RSS emitted <category>category:development</category> *and*
-- <category>tag:development</category>.
--
-- Scoped to the Poche corpus on purpose: a pre-pivot row may legitimately carry
-- a real topic tag that happens to equal its category, and those rows keep
-- their tags. This deletes rows, unlike retention — but article_tags is a
-- derived table with no dedupe role, so nothing is lost that the next tick
-- would need; the articles rows themselves are untouched.
DELETE FROM article_tags
 WHERE article_id IN (SELECT id FROM articles WHERE source_id = 'poche-explore')
   AND tag = (SELECT a.category FROM articles a WHERE a.id = article_tags.article_id);
