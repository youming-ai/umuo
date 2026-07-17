// Shared season-leaders aggregator. PURE — no DOM/React/browser APIs — so the
// Cloudflare Worker (worker/index.ts), the app (src/hooks/useLeaders.ts), and
// the Vite dev middleware (vite.config.ts) all compile and reuse this one
// implementation (same single-source discipline as competitions.ts/buildUrl).
// `fetch` is injected so tests can supply a canned fake (zero network).

import type { Leader } from './types';
import { arr, obj, str } from './utils/coerce';

// ESPN's season leaders live on the CORE api (not site.api), one document per
// sport/league/season/type. Each category (`goals`, `points`, `assists`, …)
// holds `leaders[]`, and every leader references its athlete/team by $ref
// (no inline names) — hence the fan-out below.
const CORE = 'https://sports.core.api.espn.com/v2';

// The leaders pipeline only fetches by URL string. Narrowing this from
// `typeof fetch` lets src/data/api.ts inject a timeout/retry-wrapped fetch
// (fetchWithRetry) so a hung ESPN $ref fails fast instead of hanging every
// coalesced caller until the Workers subrequest cap.
type FetchByURL = (url: string, init?: RequestInit) => Promise<Response>;

export interface LeadersConfig {
  sport: string; // ESPN sport slug, e.g. 'soccer' / 'basketball'
  league: string; // ESPN league slug, e.g. 'eng.1' / 'nba'
  season: number; // ending/starting year per sport (from seasonForDate)
  type: number; // season type: soccer regular = 1, nba regular = 2
  category: string; // which leaders category to surface: 'goals' / 'points'
  topN: number; // how many rows to keep (and how many refs to fan out to)
}

// Per-sport { type, category }: which single category is "the" leaderboard.
// Other sports are added when a competition needs them (YAGNI).
export const LEADERS_BY_SPORT: Record<string, { type: number; category: string }> = {
  soccer: { type: 1, category: 'goals' },
  basketball: { type: 2, category: 'points' },
};

// A single leaders row before its refs are resolved.
interface RawRow {
  displayValue: string;
  value: number;
  athleteRef: string;
  teamRef: string;
}

// Resolve $refs with a small concurrency cap so we never blow past the
// Cloudflare Workers 50-subrequest limit (topN 15 + deduped teams ≈ ≤25).
async function resolveRefs(
  fetchImpl: FetchByURL,
  refs: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const limit = 10;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < refs.length) {
      const ref = refs[i++];
      try {
        const res = await fetchImpl(ref);
        if (!res.ok) continue; // degrade: leave the ref unresolved
        out.set(ref, obj(await res.json()));
      } catch {
        // degrade: any network/parse failure leaves this ref unresolved
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, refs.length) }, () => worker()));
  return out;
}

export async function assembleLeaders(
  fetchImpl: FetchByURL,
  cfg: LeadersConfig,
): Promise<Leader[]> {
  const url = `${CORE}/sports/${cfg.sport}/leagues/${cfg.league}/seasons/${cfg.season}/types/${cfg.type}/leaders`;

  // Primary-doc failures (bad HTTP status or unparseable JSON) THROW rather
  // than degrading to [] — an empty result here is indistinguishable from a
  // legitimately empty leaderboard, and the Worker relies on this throwing so
  // it can serve a stale cached copy instead of overwriting it with an empty
  // one (Finding 2). Only per-row $ref resolution failures degrade silently
  // (see resolveRefs) — those are row-local, not primary-doc failures.
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`leaders upstream ${res.status}`);
  const payload = obj(await res.json());

  const category = arr(payload.categories)
    .map(obj)
    .find((c) => str(c.name) === cfg.category);
  if (!category) throw new Error(`leaders category ${cfg.category} not found`);

  const rows: RawRow[] = arr(category.leaders)
    .map(obj)
    .map((l) => ({
      displayValue: str(l.displayValue),
      value: Number(l.value) || 0,
      athleteRef: str(obj(l.athlete).$ref),
      teamRef: str(obj(l.team).$ref),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, cfg.topN);

  // Dedupe refs so a team shared by several leaders is fetched once.
  const refs = [
    ...new Set([
      ...rows.map((r) => r.athleteRef).filter(Boolean),
      ...rows.map((r) => r.teamRef).filter(Boolean),
    ]),
  ];
  const resolved = await resolveRefs(fetchImpl, refs);

  return rows.map((r, i): Leader => {
    const athlete = resolved.get(r.athleteRef);
    const team = resolved.get(r.teamRef);
    const logos = team ? arr(team.logos) : [];
    return {
      rank: i + 1,
      name: athlete ? str(athlete.displayName) || str(athlete.shortName) : '',
      teamName: team ? str(team.displayName) : '',
      teamLogo: logos.length ? str(obj(logos[0]).href) : '',
      displayValue: r.displayValue,
      value: r.value,
    };
  });
}

export interface LeaderboardSpec {
  category: string; // leaders doc `categories[].name` (verified live per sport)
  label: string; // board heading / stat column label
  group: string; // ESPN-style grouping (Scoring / Discipline / …)
}

export interface Leaderboard {
  key: string;
  label: string;
  group: string;
  leaders: Leader[];
}

// Which categories to surface per sport, grouped ESPN-style. Kept to 4 boards ×
// topN 5 so total $ref fan-out (athletes + deduped teams + the doc) stays well
// under the Cloudflare Workers 50-subrequest cap.
export const LEADERBOARDS_BY_SPORT: Record<string, LeaderboardSpec[]> = {
  soccer: [
    { category: 'goals', label: 'Goals', group: 'Scoring' },
    { category: 'assists', label: 'Assists', group: 'Scoring' },
    { category: 'yellowCards', label: 'Yellow Cards', group: 'Discipline' },
    { category: 'saves', label: 'Saves', group: 'Goalkeeping' },
  ],
  basketball: [
    { category: 'pointsPerGame', label: 'Points', group: 'Scoring' },
    { category: 'assistsPerGame', label: 'Assists', group: 'Playmaking' },
    { category: 'reboundsPerGame', label: 'Rebounds', group: 'Rebounding' },
    { category: 'blocksPerGame', label: 'Blocks', group: 'Defense' },
  ],
};

// Assemble MULTIPLE leaderboards from ONE leaders document: one upstream fetch,
// then a single shared $ref resolution across every board's rows. Same failure
// contract as assembleLeaders (primary doc throws → serve-stale covers it;
// per-row ref failures degrade silently). Boards with no rows are dropped.
export async function assembleLeaderboards(
  fetchImpl: FetchByURL,
  cfg: { sport: string; league: string; season: number; type: number; topN: number },
  specs: LeaderboardSpec[],
): Promise<Leaderboard[]> {
  const url = `${CORE}/sports/${cfg.sport}/leagues/${cfg.league}/seasons/${cfg.season}/types/${cfg.type}/leaders`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`leaders upstream ${res.status}`);
  const payload = obj(await res.json());
  const categories = arr(payload.categories).map(obj);

  const perSpec = specs.map((spec) => {
    const category = categories.find((c) => str(c.name) === spec.category);
    const rows: RawRow[] = arr(category?.leaders)
      .map(obj)
      .map((l) => ({
        displayValue: str(l.displayValue),
        value: Number(l.value) || 0,
        athleteRef: str(obj(l.athlete).$ref),
        teamRef: str(obj(l.team).$ref),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, cfg.topN);
    return { spec, rows };
  });

  const refs = [
    ...new Set(
      perSpec
        .flatMap(({ rows }) => [...rows.map((r) => r.athleteRef), ...rows.map((r) => r.teamRef)])
        .filter(Boolean),
    ),
  ];
  const resolved = await resolveRefs(fetchImpl, refs);

  return perSpec
    .filter(({ rows }) => rows.length > 0)
    .map(
      ({ spec, rows }): Leaderboard => ({
        key: spec.category,
        label: spec.label,
        group: spec.group,
        leaders: rows.map((r, i): Leader => {
          const athlete = resolved.get(r.athleteRef);
          const team = resolved.get(r.teamRef);
          const logos = team ? arr(team.logos) : [];
          return {
            rank: i + 1,
            name: athlete ? str(athlete.displayName) || str(athlete.shortName) : '',
            teamName: team ? str(team.displayName) : '',
            teamLogo: logos.length ? str(obj(logos[0]).href) : '',
            displayValue: r.displayValue,
            value: r.value,
          };
        }),
      }),
    );
}
