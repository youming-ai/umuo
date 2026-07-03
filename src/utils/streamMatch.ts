import type { CompMatch, Match } from '../types';
import { slugify } from './helpers';

// ESPN and ppv.to spell some nations differently (ESPN uses "Türkiye",
// "Czechia", "United States"; ppv tends toward "Turkey", "Czech Republic",
// "USA"). Map each known variant *team* slug to a single canonical token so
// both sides collapse to the same value before comparison. Extend as new
// divergences surface — it's the one knob the two providers force on us.
const TEAM_SLUG_ALIASES: Record<string, string> = {
  turkiye: 'turkey',
  czechia: 'czech-republic',
  'united-states': 'usa',
  'korea-republic': 'south-korea',
  'ir-iran': 'iran',
  'cote-divoire': 'ivory-coast',
  'bosnia-and-herzegovina': 'bosnia-herzegovina',
};

// A pair slug is "<home>-vs-<away>"; canonicalise each side's team token.
// (No national team's name contains "vs", so splitting on "-vs-" is safe.)
function normalizePairSlug(slug: string): string {
  return slug
    .split('-vs-')
    .map((team) => TEAM_SLUG_ALIASES[team] ?? team)
    .join('-vs-');
}

// Index ppv streams by their canonical pair slug for O(1) lookup. Built once
// per stream list so a full schedule sweep stays O(matches + streams) rather
// than O(matches × streams). First stream wins on a slug collision.
export function indexStreams(streams: Match[]): Map<string, Match> {
  const bySlug = new Map<string, Match>();
  for (const s of streams) {
    const key = normalizePairSlug(s.slug);
    if (!bySlug.has(key)) bySlug.set(key, s);
  }
  return bySlug;
}

// ESPN fixtures and ppv streams share no id, so they're matched by canonical
// team-name slug (both orderings, since ppv may list home/away reversed).
// Finished fixtures never resolve: matching on names alone would otherwise tag
// the already-played leg of a rematch (same two teams in the group stage and a
// knockout) whose later leg is the one actually streaming.
export function streamForMatch(match: CompMatch, bySlug: Map<string, Match>): Match | null {
  if (match.status === 'finished') return null;
  const a = normalizePairSlug(slugify(`${match.homeName}-vs-${match.awayName}`));
  const b = normalizePairSlug(slugify(`${match.awayName}-vs-${match.homeName}`));
  return bySlug.get(a) ?? bySlug.get(b) ?? null;
}

// Live-state of a ppv stream (lifted from the old LiveView.classify). The feed
// only carries a 2-state status, so this is best-effort: alwaysLive feeds are
// always live; otherwise live iff `now` is within [startsAt, endsAt). Uses
// `!= null` so a literal 0 is treated as a real (1970) boundary, not "unset".
export function isStreamLive(stream: Match, now: number): boolean {
  if (stream.alwaysLive) return true;
  const start = stream.startsAt != null ? stream.startsAt * 1000 : null;
  const end = stream.endsAt != null ? stream.endsAt * 1000 : null;
  if (start != null && now < start) return false;
  if (end != null && now >= end) return false;
  return true;
}

// The matched stream for a fixture, but only when it is currently live —
// the single resolution used by both the schedule "watch" badge and the
// match-page player, so timing lives in one place.
export function liveStreamForMatch(
  match: CompMatch,
  bySlug: Map<string, Match>,
  now: number,
): Match | null {
  const s = streamForMatch(match, bySlug);
  return s && isStreamLive(s, now) ? s : null;
}
