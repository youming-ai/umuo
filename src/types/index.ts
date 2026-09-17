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
}

export interface ExploreFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface ExploreFilterSet {
  categories: ExploreFilterOption[];
}
