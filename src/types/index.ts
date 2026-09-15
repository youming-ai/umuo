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
  imageWidth: number; // 0 when the feed gave no dimensions
  imageHeight: number;
  sourceId: string;
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
