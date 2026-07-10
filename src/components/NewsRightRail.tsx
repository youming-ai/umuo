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
            {trending.map((item, i) => (
              <a
                key={item.id || `trend-${i}`}
                href={item.link}
                target={item.link.startsWith('https://') ? '_blank' : undefined}
                rel={item.link.startsWith('https://') ? 'noopener noreferrer' : undefined}
                className="text-xs text-chalk hover:text-pitch transition-colors leading-snug line-clamp-2 px-1"
              >
                {item.headline}
              </a>
            ))}
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
                className="flex flex-col gap-0.5 p-2 rounded-card bg-overlay/5 border border-line/25 hover:bg-overlay/10 hover:border-line/50 text-left transition-all duration-200"
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
