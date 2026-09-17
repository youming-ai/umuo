// Facade — keeps `import { … } from '../data/api'` working while the
// implementation lives in cache/explore/sitemapData.
export type { Env } from './cache';
export { json, runCached } from './cache';
export * from './explore';
export * from './sitemapData';
