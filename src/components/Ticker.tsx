import { useStreams } from '../hooks/useStreams';
import type { Match } from '../types';

// Signature element: a persistent live-score strip pinned above the header —
// the "top banner" region, but honest to a live-streams hub instead of an ad.
// Fed by useStreams (ppv.st, browser-only, cross-competition), so it needs no
// props and no SSR seed. Renders null when nothing is live or coming up.

export interface TickerItem {
  id: number;
  name: string;
  live: boolean;
  startsAt?: number;
}

// Pure selection: live streams first (in feed order), then the next few
// upcoming ones by kickoff. Exported for the colocated test.
export function selectTickerMatches(matches: Match[], nowSec: number): TickerItem[] {
  const live: TickerItem[] = [];
  const soon: TickerItem[] = [];
  for (const m of matches) {
    const isLive =
      m.alwaysLive ||
      (m.startsAt != null && m.startsAt <= nowSec && (m.endsAt == null || nowSec <= m.endsAt));
    if (isLive) {
      live.push({ id: m.id, name: m.name, live: true, startsAt: m.startsAt });
    } else if (m.startsAt != null && m.startsAt > nowSec) {
      soon.push({ id: m.id, name: m.name, live: false, startsAt: m.startsAt });
    }
  }
  soon.sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));
  return [...live, ...soon.slice(0, 10)];
}

function clock(startsAt?: number): string {
  if (startsAt == null) return '';
  return new Date(startsAt * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Ticker() {
  const { matches } = useStreams();
  const items = selectTickerMatches(matches, Date.now() / 1000);
  if (items.length === 0) return null;

  return (
    <div className="border-b border-line/30 bg-panel/60 backdrop-blur-md">
      {/* ponytail: items are display-only; mapping each to its fixture needs the
          per-comp stream index the ticker doesn't hold — wire if users ask. */}
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar px-page-x md:px-page-x-md py-1.5">
        {items.map((it) => (
          <span
            key={it.id}
            className="flex items-center gap-1.5 whitespace-nowrap ds-caption text-chalkdim"
          >
            {it.live ? (
              <span className="live-dot rounded-full" aria-hidden />
            ) : (
              <span className="tabular-nums text-chalkdim/70">{clock(it.startsAt)}</span>
            )}
            <span className="font-medium text-chalk">{it.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
