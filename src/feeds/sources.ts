import { CATEGORIES } from '../categories';
import type { FeedSource } from './types';

export const POCHE_EXPLORE_URL = 'https://poche.app/explore/rss';

const FEED_SOURCE_DEFS: FeedSource[] = [
  {
    id: 'poche-explore',
    kind: 'rss',
    name: 'Poche Explore',
    url: POCHE_EXPLORE_URL,
    authorityScore: 90,
    defaultEnabled: true,
  },
];

// Registry self-check: preset categories must exist in the registry, otherwise
// a typo silently misfiles every story from that source.
for (const source of FEED_SOURCE_DEFS) {
  if (source.category && !Object.hasOwn(CATEGORIES, source.category)) {
    throw new Error(`source ${source.id} declares unknown category ${source.category}`);
  }
}

export const FEED_SOURCES = [...FEED_SOURCE_DEFS] satisfies FeedSource[];

export const FEED_SOURCE_BY_ID = new Map(FEED_SOURCES.map((source) => [source.id, source]));
