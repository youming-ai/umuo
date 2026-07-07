import type { CompMatch } from '../types';

// The scoreboard-bar selection: live matches first (by kickoff), then the rest
// of today's matches (by kickoff), then the nearest upcoming beyond today to
// top up a thin day — capped so the bar stays a glanceable strip. `now` is
// injected so the selection is deterministically testable.
export function marqueeMatches(matches: CompMatch[], now: number, cap = 15): CompMatch[] {
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
  const out: CompMatch[] = [];
  for (const x of [...live, ...today_, ...future]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}
