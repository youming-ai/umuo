import { CATEGORIES } from '../categories';
import type { FeedSource } from './types';

// FEED_SOURCES is the single registry consumed by ingest; keep id stable (used
// as D1 source_id). Every URL here was probe-verified (200 + RSS/Atom body).
const HARDWARE_RSS_SOURCES: FeedSource[] = [
  // --- Broad PC hardware desks ---
  {
    id: 'toms-hardware',
    kind: 'rss',
    name: "Tom's Hardware",
    url: 'https://www.tomshardware.com/feeds.xml',
    authorityScore: 92,
    defaultEnabled: true,
  },
  {
    id: 'techpowerup-news',
    kind: 'rss',
    name: 'TechPowerUp News',
    url: 'https://www.techpowerup.com/rss/news',
    authorityScore: 90,
    defaultEnabled: true,
  },
  {
    id: 'techpowerup-reviews',
    kind: 'rss',
    name: 'TechPowerUp Reviews',
    url: 'https://www.techpowerup.com/rss/reviews',
    authorityScore: 88,
    defaultEnabled: true,
  },
  {
    id: 'ars-gadgets',
    kind: 'rss',
    name: 'Ars Technica Gadgets',
    url: 'https://arstechnica.com/gadgets/feed/',
    authorityScore: 88,
    defaultEnabled: true,
  },
  {
    id: 'verge-tech',
    kind: 'rss',
    name: 'The Verge Tech',
    url: 'https://www.theverge.com/rss/index.xml',
    authorityScore: 85,
    defaultEnabled: true,
  },
  {
    id: 'guru3d',
    kind: 'rss',
    name: 'Guru3D',
    url: 'https://www.guru3d.com/rss.xml',
    authorityScore: 85,
    defaultEnabled: true,
  },
  {
    id: 'kitguru',
    kind: 'rss',
    name: 'KitGuru',
    url: 'https://www.kitguru.net/feed/',
    authorityScore: 85,
    defaultEnabled: true,
  },
  {
    id: 'hexus',
    kind: 'rss',
    name: 'Hexus',
    url: 'https://www.hexus.net/rss/',
    authorityScore: 82,
    defaultEnabled: true,
  },
  {
    id: 'wccftech',
    kind: 'rss',
    name: 'Wccftech',
    url: 'https://wccftech.com/feed/',
    authorityScore: 78,
    defaultEnabled: true,
  },
  // --- Category-vertical sources: the publisher has already told us which
  // category a story belongs to, so `category` is attributed without waiting
  // on AI enrichment.
  {
    id: 'tftcentral',
    kind: 'rss',
    name: 'TFT Central',
    url: 'https://tftcentral.co.uk/feed',
    category: 'monitor',
    authorityScore: 80,
    defaultEnabled: true,
  },
  {
    id: 'keyboard-newswire',
    kind: 'rss',
    name: 'Keyboard Newswire',
    url: 'https://keyboard-newswire.com/feed',
    category: 'keyboards',
    authorityScore: 72,
    defaultEnabled: true,
  },
  {
    id: 'kbd-news',
    kind: 'rss',
    name: "Keyboard Builders' Digest",
    url: 'https://kbd.news/rss.xml',
    category: 'keyboards',
    authorityScore: 70,
    defaultEnabled: true,
  },
  // --- Community desks (Reddit Atom). High volume, mixed quality — the LLM
  // quality gate does the editorial work.
  {
    id: 'r-mechanicalkeyboards',
    kind: 'rss',
    name: 'r/MechanicalKeyboards',
    url: 'https://www.reddit.com/r/MechanicalKeyboards/.rss',
    category: 'keyboards',
    authorityScore: 60,
    defaultEnabled: true,
  },
  {
    id: 'r-mousereview',
    kind: 'rss',
    name: 'r/MouseReview',
    url: 'https://www.reddit.com/r/MouseReview/.rss',
    category: 'mice',
    authorityScore: 60,
    defaultEnabled: true,
  },
  {
    id: 'r-hardware',
    kind: 'rss',
    name: 'r/hardware',
    url: 'https://www.reddit.com/r/hardware/.rss',
    authorityScore: 65,
    defaultEnabled: true,
  },
];

// Registry self-check: preset categories must exist in the registry, otherwise
// a typo silently misfiles every story from that source.
for (const source of HARDWARE_RSS_SOURCES) {
  if (source.category && !Object.hasOwn(CATEGORIES, source.category)) {
    throw new Error(`source ${source.id} declares unknown category ${source.category}`);
  }
}

export const FEED_SOURCES = [...HARDWARE_RSS_SOURCES] satisfies FeedSource[];

export const FEED_SOURCE_BY_ID = new Map(FEED_SOURCES.map((source) => [source.id, source]));
