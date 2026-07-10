import type { CompMatch } from '../types';

// Matches may carry a competition key when merged across leagues (ticker).
// Deduping by id alone would drop a match if two comps ever share an ESPN id.
type MarqueeMatch = CompMatch & { comp?: string };

function dedupeKey(m: MarqueeMatch): string {
  return m.comp ? `${m.comp}:${m.id}` : m.id;
}

// The scoreboard-bar selection: live matches first (by kickoff), then the rest
// of today's matches (by kickoff), then the nearest upcoming beyond today to
// top up a thin day — capped so the bar stays a glanceable strip. `now` is
// injected so the selection is deterministically testable.
export function marqueeMatches<T extends MarqueeMatch>(matches: T[], now: number, cap = 15): T[] {
  const today = new Date(now);
  const sameDay = (d: Date | null): boolean =>
    !!d &&
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const ts = (m: CompMatch): number => (m.kickoff ? m.kickoff.getTime() : 0);

  const live = matches.filter((x) => x.status === 'live').sort((a, b) => ts(a) - ts(b));
  const today_ = matches
    .filter((x) => x.status !== 'live' && sameDay(x.kickoff))
    .sort((a, b) => ts(a) - ts(b));
  const future = matches
    .filter((x) => x.status === 'upcoming' && !sameDay(x.kickoff) && ts(x) > now)
    .sort((a, b) => ts(a) - ts(b));

  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of [...live, ...today_, ...future]) {
    const key = dedupeKey(x);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}
