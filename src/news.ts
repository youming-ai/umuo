// Single source of truth for the ESPN "now" news feed URL, its param
// whitelist, cache TTL and cache key — shared by the Worker (worker/index.ts)
// and the Vite dev middleware (vite.config.ts). Same double-source discipline
// as competitions.ts/buildUrl and leaders.ts: pure, no DOM/React, so both
// build targets (app tsconfig + tsconfig.worker.json) compile it.

const NEWS = 'https://now.core.api.espn.com/v1/sports/news';

export interface NewsParams {
  limit?: number; // 1..50, default 20
  sport?: string; // ESPN sport slug, e.g. 'soccer' / 'basketball'
  leagues?: string; // ESPN league slug, e.g. 'nba' / 'eng.1'
  team?: string; // team abbreviation, e.g. 'che'
}

// Parse a request query into a WHITELISTED NewsParams — only these four keys
// ever reach the upstream, so arbitrary caller query can't be injected.
export function newsParamsFromQuery(q: URLSearchParams): NewsParams {
  const params: NewsParams = {};
  const limit = Number(q.get('limit'));
  if (Number.isFinite(limit) && limit > 0)
    params.limit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const sport = q.get('sport');
  if (sport) params.sport = sport;
  const leagues = q.get('leagues');
  if (leagues) params.leagues = leagues;
  const team = q.get('team');
  if (team) params.team = team;
  return params;
}

export function buildNewsUrl(p: NewsParams): string {
  const q = new URLSearchParams();
  q.set('limit', String(p.limit ?? 20));
  if (p.sport) q.set('sport', p.sport);
  if (p.leagues) q.set('leagues', p.leagues);
  if (p.team) q.set('team', p.team);
  return `${NEWS}?${q}`;
}

// A feed filtered by sport/league/team changes more slowly than the global
// firehose, so it can stay fresh longer (PRD §5 cache table).
export function newsFresh(p: NewsParams): number {
  return p.sport || p.leagues || p.team ? 300 : 120;
}

// Stable KV key: same filters → same key regardless of original query order.
export function newsCacheKey(p: NewsParams): string {
  return `news:${p.sport ?? ''}:${p.leagues ?? ''}:${p.team ?? ''}:${p.limit ?? 20}`;
}
