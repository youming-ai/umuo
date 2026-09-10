export type FeedSourceKind = 'rss';

export interface FeedSource {
  id: string;
  kind: FeedSourceKind;
  name: string;
  url: string;
  /** Publisher-declared category extracted from the feed when available. */
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
  url: string;
  canonicalUrl: string;
  imageUrl: string;
  imageWidth: number; // 0 when unknown
  imageHeight: number; // 0 when unknown
  publishedAt: number;
  fetchedAt: number;
  fingerprint: string;
}
