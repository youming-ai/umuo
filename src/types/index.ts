// --- Curated Explore content (D1 content layer) ---

export type ExploreArticleType =
  | 'link'
  | 'news'
  | 'review'
  | 'deal'
  | 'leak'
  | 'analysis'
  | 'guide'
  | 'video';

export interface ExploreArticle {
  id: string;
  title: string;
  description: string;
  summary: string;
  blurb: string;
  url: string;
  imageUrl: string;
  /** True when `imageUrl` is a playable video rather than an image. Judged on
   *  the URL as the feed delivered it, before the /media rewrite — that rewrite
   *  can strip the extension the judgement depends on. */
  isVideo: boolean;
  imageWidth: number; // 0 when the feed gave no dimensions
  imageHeight: number;
  sourceDomain: string;
  publishedAt: number;
  /** Canonical category key from src/categories.ts, null when unattributed. */
  category: string | null;
  articleType: ExploreArticleType;
  tags: string[];
  qualityScore: number;
  freshnessScore: number;
}

export interface ExploreFeed {
  items: ExploreArticle[];
  /** Opaque; pass back as `cursor` for the next page. null when exhausted. */
  nextCursor: string | null;
  /** Set by the SSR composer when the feed could not be read at all, so the
   *  page can say so rather than blaming the reader's filters. Never part of
   *  the cached API payload, so it does not change the explore key's shape. */
  unavailable?: boolean;
}

export interface ExploreFilterOption {
  value: string;
  label: string;
  /** `null` when the counts could not be read. An outage must not render as a
   *  confident zero — the rail still links to the hub. */
  count: number | null;
}

export interface ExploreFilterSet {
  categories: ExploreFilterOption[];
}
