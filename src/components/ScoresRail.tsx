import { Trophy } from 'lucide-react';
import { COMPETITIONS } from '../competitions';
import type { TickerMatch } from '../hooks/useTicker';
import { pathFor } from '../utils/router';
import { formatTickerLine } from './Ticker';

interface ScoresRailProps {
  scores: TickerMatch[];
  loading?: boolean;
}

// Competition hub right rail: today's cross-competition scores. The center
// column already IS the league news feed, so the rail carries only what the
// feed doesn't — no headline echo.
export default function ScoresRail({ scores, loading = false }: ScoresRailProps) {
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="ds-glass p-4 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-chalkdim uppercase px-1 flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5" />
          <span>Today's Scores</span>
        </h3>
        {scores.length === 0 ? (
          <p className="text-xs text-chalkdim px-1 py-2 italic">
            {loading ? 'Loading scores...' : 'No matches right now.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {scores.map((m) => (
              <a
                key={`${m.comp}-${m.id}`}
                href={pathFor({ kind: 'match', comp: m.comp, slug: m.slug })}
                className="flex flex-col gap-0.5 p-2 rounded-card bg-overlay/5 border border-line/25 hover:bg-overlay/10 hover:border-line/50 text-left ds-press"
              >
                <span className="text-caption font-mono uppercase text-chalkdim">
                  {COMPETITIONS[m.comp]?.label ?? m.comp}
                </span>
                <span className="text-xs text-chalk flex items-center gap-1.5">
                  {m.status === 'live' && (
                    <span className="live-dot rounded-full shrink-0" aria-hidden />
                  )}
                  {formatTickerLine(m)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
