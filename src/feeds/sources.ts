import type { FeedSource } from './types';

const POCHE_EXPLORE_URL = 'https://poche.app/explore/rss';

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

export const FEED_SOURCES = [...FEED_SOURCE_DEFS] satisfies FeedSource[];
