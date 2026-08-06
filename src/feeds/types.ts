import type { Sport } from '../competitions';

export type FeedSourceKind = 'rss' | 'api-json';

export interface FeedSource {
  id: string;
  kind: FeedSourceKind;
  name: string;
  url: string;
  sport: Sport;
  comp?: string;
  authorityScore: number;
  defaultEnabled: boolean;
}

// Queue messages are deliberately plain data. They cross the Worker → Queue
// → Durable Object boundary and must remain structured-clone serializable.
export interface RawArticle {
  sourceId: string;
  sourceName: string;
  sourceAuthority: number;
  comp: string | null;
  title: string;
  description: string;
  url: string;
  canonicalUrl: string;
  imageUrl: string;
  publishedAt: number;
  fetchedAt: number;
  fingerprint: string;
}

export type ArticleType =
  | 'news'
  | 'analysis'
  | 'rumor'
  | 'interview'
  | 'match-report'
  | 'transfer'
  | 'injury'
  | 'video';

export interface ArticleEnrichment {
  isFootball: boolean;
  competition: string;
  articleType: ArticleType;
  tags: string[];
  summary: string;
  blurb: string;
  qualityScore: number;
}
