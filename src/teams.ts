// Pure, defensive parse of ESPN's site.api teams list into TeamSummary[].
// Shape: sports[0].leagues[0].teams[].team {id, displayName, abbreviation,
// logos[].href, color}. Same obj/arr/str discipline as newsFeed.ts — no
// DOM/React, unit-testable in isolation.
import type { TeamSummary } from './types';
import { arr, obj, str } from './utils/coerce';

export function parseTeams(json: unknown): TeamSummary[] {
  const leagues = arr(obj(arr(obj(json).sports)[0]).leagues);
  return arr(obj(leagues[0]).teams)
    .map((raw) => obj(obj(raw).team))
    .filter((t) => str(t.id))
    .map(
      (t): TeamSummary => ({
        id: str(t.id),
        name: str(t.displayName),
        abbrev: str(t.abbreviation),
        logo: str(obj(arr(t.logos)[0]).href),
        color: str(t.color),
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
