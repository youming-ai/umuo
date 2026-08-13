// --- AI-curated football news (D1 content layer) ---

export type ExploreArticleType =
  | 'news'
  | 'analysis'
  | 'rumor'
  | 'interview'
  | 'match-report'
  | 'transfer'
  | 'injury'
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
  sourceName: string;
  sourceDomain: string;
  publishedAt: number;
  competition: string | null;
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
  competitions: ExploreFilterOption[];
  sources: ExploreFilterOption[];
  tags: ExploreFilterOption[];
}

// --- ESPN league news feed (ingest source) ---

export interface NewsTag {
  kind: 'team' | 'athlete' | 'league';
  label: string;
  team?: string;
  leagueSlug?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  description: string;
  published: string; // ISO
  byline: string;
  imageUrl: string; // '' when the headline has no image
  imageWidth: number; // 0 when unknown
  imageHeight: number; // 0 when unknown
  link: string; // external espn.com article URL (links.web.href)
  tags: NewsTag[];
}
