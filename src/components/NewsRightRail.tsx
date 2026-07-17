import { Flame, Trophy } from 'lucide-react';
import { COMPETITIONS } from '../competitions';
import type { TickerMatch } from '../hooks/useTicker';
import type { NewsItem } from '../types';
import { pathFor } from '../utils/router';
import { formatTickerLine } from './Ticker';

interface NewsRightRailProps {
  trending: NewsItem[];
  scores: TickerMatch[];
  newsLoading?: boolean;
  scoresLoading?: boolean;
}

export default function NewsRightRail({
  trending,
  scores,
  newsLoading = false,
  scoresLoading = false,
}: NewsRightRailProps) {
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="ds-glass p-4 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-chalkdim uppercase px-1 flex items-center gap-2">
          <Flame className="w-3.5 h-3.5 text-amber" />
          <span>Top Headlines</span>
        </h3>
        {trending.length === 0 ? (
          <p className="text-xs text-chalkdim px-1 py-2 italic">
            {newsLoading ? 'Loading headlines...' : 'No headlines right now.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {trending.map((item, i) => {
              // Defense-in-depth: only render a clickable anchor for http(s)
              // or same-origin (/) links — anything else (javascript:/data:)
              // degrades to a non-clickable span. Mirrors NewsView's guard.
              const external = item.link.startsWith('https://');
              const linked = external || item.link.startsWith('/');
              const key = item.id || `trend-${i}`;
              const cls = 'text-xs leading-snug line-clamp-2 px-1';
              return linked ? (
                <a
                  key={key}
                  href={item.link}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                  className={`${cls} text-chalk hover:text-pitch transition-colors`}
                >
                  {item.headline}
                </a>
              ) : (
                <span key={key} aria-disabled className={`${cls} text-chalkdim`}>
                  {item.headline}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="ds-glass p-4 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-chalkdim uppercase px-1 flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5" />
          <span>Today's Scores</span>
        </h3>
        {scores.length === 0 ? (
          <p className="text-xs text-chalkdim px-1 py-2 italic">
            {scoresLoading ? 'Loading scores...' : 'No matches right now.'}
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
                <span className="text-xs font-medium text-chalk flex items-center gap-1.5">
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
