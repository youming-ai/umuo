export type FeedSourceKind = 'rss';

export interface FeedSource {
  id: string;
  kind: FeedSourceKind;
  name: string;
  url: string;
  /** Publisher-declared category. When set, the story is attributed without
   *  waiting on AI enrichment (the model can still override it). */
  category?: string;
  authorityScore: number;
  defaultEnabled: boolean;
}

// Ingest messages are deliberately plain data — they cross the Worker boundary
// and must remain structured-clone serializable.
export interface RawArticle {
  sourceId: string;
  sourceName: string;
  sourceAuthority: number;
  category: string | null;
  title: string;
  description: string;
  /** Full article text when the feed syndicates it (content:encoded) or when
   *  ingest fetched the page body. Empty for teaser-only feeds that weren't
   *  fetched. The LLM prompt prefers this over `description`. */
  body?: string;
  url: string;
  canonicalUrl: string;
  imageUrl: string;
  imageWidth: number; // 0 when unknown
  imageHeight: number; // 0 when unknown
  publishedAt: number;
  fetchedAt: number;
  fingerprint: string;
}

export type ArticleType = 'news' | 'review' | 'deal' | 'leak' | 'analysis' | 'guide' | 'video';

export interface ArticleEnrichment {
  /** True only for on-topic stories (technology: AI, consumer electronics,
   *  PC hardware, peripherals). Off-topic items are stored as filtered
   *  regardless of quality. */
  isOnTopic: boolean;
  /** Canonical category key from src/categories.ts, or '' when the story
   *  doesn't clearly belong to one category. */
  category: string;
  articleType: ArticleType;
  tags: string[];
  summary: string;
  blurb: string;
  qualityScore: number;
}
