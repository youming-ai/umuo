import { type TickerMatch, useTicker } from '../hooks/useTicker';
import { pathFor } from '../utils/router';

// Signature element: a persistent live-score strip pinned above the header.
// Fed by ESPN scoreboards across all registered competitions (marqueeMatches).

export function formatTickerLine(m: TickerMatch): string {
  const teams = `${m.homeName} – ${m.awayName}`;
  if (m.status === 'live') {
    const score = `${m.homeScore ?? 0}-${m.awayScore ?? 0}`;
    const clock = m.progress?.displayClock || m.statusText || 'LIVE';
    return `${score} ${teams} ${clock}`;
  }
  if (m.status === 'finished') {
    return `${m.homeScore ?? 0}-${m.awayScore ?? 0} ${teams}`;
  }
  const time = m.kickoff
    ? m.kickoff.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
  return time ? `${time} ${teams}` : teams;
}

export default function Ticker() {
  const { items } = useTicker();
  if (items.length === 0) return null;

  const tickerItems = (isDuplicate = false) => (
    <div
      className={`marquee-group flex items-center gap-4 px-page-x py-1.5 md:px-page-x-md${isDuplicate ? ' marquee-copy' : ''}`}
      aria-hidden={isDuplicate || undefined}
    >
      {items.map((m) => (
        <a
          key={`${m.comp}-${m.id}`}
          href={pathFor({ kind: 'match', comp: m.comp, slug: m.slug })}
          className="flex items-center gap-1.5 whitespace-nowrap ds-caption text-chalkdim hover:text-chalk transition-colors"
          tabIndex={isDuplicate ? -1 : undefined}
        >
          {m.status === 'live' && <span className="live-dot rounded-full" aria-hidden />}
          <span className="font-medium text-chalk">{formatTickerLine(m)}</span>
        </a>
      ))}
    </div>
  );

  return (
    <div className="border-b border-line/30 bg-panel/60 backdrop-blur-md">
      <div className="marquee-viewport no-scrollbar">
        <div className="marquee-track flex w-max">
          {tickerItems()}
          {tickerItems(true)}
        </div>
      </div>
    </div>
  );
}
