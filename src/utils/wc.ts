import type { MatchProgress, MatchStatus, ProgressStatus, ScorerEntry, WCStanding } from '../types';
import { slugify } from './helpers';

export function parseScore(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'string' && s.trim() === '') return null;
  const n = typeof s === 'number' ? s : Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

// ESPN status: competition.status.type.state is 'pre' | 'in' | 'post'.
// We also use `displayClock === 'HT'` to detect half-time, since ESPN doesn't
// reliably emit a distinct 'halftime' state on every endpoint.
export function statusFromState(state: string | undefined): MatchStatus {
  if (state === 'post') return 'finished';
  if (state === 'in' || state === 'halftime') return 'live';
  return 'upcoming';
}

// Fine-grained status from the full ESPN status object. Returns undefined
// for 'pre' state — callers should treat a missing `progress` as "kickoff
// time, no in-game data yet". The `displayClock` value (e.g. '23'', 'HT',
// '90'+5'', 'FT') is taken straight from ESPN so the UI shows whatever the
// broadcaster's data feed is reporting.
//
// The input shape is loose: ESPN's scoreboard endpoint puts `period` under
// `type.period`, while other endpoints expose it at the top level. We
// accept both.
export function progressFromStatus(
  statusObj:
    | {
        clock?: number;
        displayClock?: string;
        type?: { state?: string; period?: number };
        period?: number;
      }
    | null
    | undefined,
): MatchProgress | undefined {
  if (!statusObj?.type) return undefined;
  const state = (statusObj.type.state || '').toLowerCase();
  const displayClock = (statusObj.displayClock || '').trim();

  let progress: ProgressStatus;
  if (state === 'post') {
    progress = 'post';
  } else if (state === 'in') {
    // ESPN sometimes marks half-time as `state: 'in'` with `displayClock: 'HT'`.
    // Treat that explicitly as halftime rather than as a live minute.
    progress = displayClock.toUpperCase() === 'HT' ? 'halftime' : 'in';
  } else if (state === 'halftime') {
    progress = 'halftime';
  } else {
    return undefined; // 'pre' or unknown → caller shows kickoff
  }

  // Clock: numeric minutes from ESPN, or 0 when not playing (HT / FT).
  // displayClock: trust ESPN — could be '23', '45'+2', 'HT', 'FT', '90'+5', 'AET'.
  const clock =
    typeof statusObj.clock === 'number' && Number.isFinite(statusObj.clock) ? statusObj.clock : 0;

  // Period: ESPN typically emits `status.period` (1/2/3/4/5). Some endpoints
  // nest it under `type.period`. Fall back to 1 when in progress and unknown.
  const period =
    typeof statusObj.type.period === 'number'
      ? statusObj.type.period
      : typeof statusObj.period === 'number'
        ? statusObj.period
        : progress === 'in'
          ? 1
          : 0;

  return {
    status: progress,
    clock,
    displayClock: displayClock || defaultClockFor(progress, clock),
    period,
  };
}

// What to show when ESPN doesn't provide a displayClock string for a state.
function defaultClockFor(state: ProgressStatus, clock: number): string {
  if (state === 'post') return 'FT';
  if (state === 'halftime') return 'HT';
  if (state === 'in' && clock > 0) return `${Math.floor(clock)}'`;
  return '';
}

// Build a URL-friendly slug from a match's home/away team names. Used by
// the /match/[slug] route for deep linking. Same slugify pipeline as the
// streamed.pk Match type so URL shapes match across data sources.
//
// The ESPN event id is appended so the slug is unique: the same two teams can
// meet more than once in a tournament (group stage + a knockout rematch), and
// resolving a route by team names alone would always open the first fixture.
export function matchSlug(homeName: string, awayName: string, eventId: string): string {
  const base = slugify(`${homeName}-vs-${awayName}`);
  return eventId ? `${base}-${eventId}` : base;
}

// Render a structured ScorerEntry as a human-readable string.
export function scorerDisplay(entry: ScorerEntry): string {
  return `${entry.name} ${entry.minute}${entry.tag}`.trim();
}

export function sortStandings(teams: WCStanding[]): WCStanding[] {
  return [...teams].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}
