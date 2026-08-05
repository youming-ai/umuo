import { useMemo } from 'react';
import { COMPETITIONS } from '../competitions';
import { type TickerMatch, useTicker } from '../hooks/useTicker';
import type { NewsItem } from '../types';
import { pathFor } from '../utils/router';
import LocalTime from './LocalTime';
import NewsCard from './NewsCard';

// Global home. The thesis is live sport: a scoreboard band of today's matches
// (live first) opens the page, then the lead story, then the aggregated feed.
// No right rail — scores and headlines are the center, not a sidebar echo.
const STATUS_ORDER: Record<TickerMatch['status'], number> = { live: 0, upcoming: 1, finished: 2 };

function TeamRow({ name, flag, score }: { name: string; flag: string; score: number | null }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {flag && <img src={flag} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />}
      <span className="min-w-0 flex-1 truncate text-sm text-chalk">{name}</span>
      <span className="font-mono font-bold tabular-nums text-chalk">{score ?? ''}</span>
    </div>
  );
}

function ScoreCard({ m }: { m: TickerMatch }) {
  const live = m.status === 'live';
  const finished = m.status === 'finished';
  const showScore = live || finished;
  const league = COMPETITIONS[m.comp]?.label ?? m.comp;

  return (
    <a
      href={pathFor({ kind: 'match', comp: m.comp, slug: m.slug })}
      className="ds-glass ds-press flex w-56 shrink-0 snap-start flex-col gap-2 p-3 hover:bg-overlay/5"
    >
      <div className="flex items-center justify-between ds-caption uppercase tracking-[0.16em] text-chalkdim">
        <span className="min-w-0 truncate">{league}</span>
        {live ? (
          <span className="flex shrink-0 items-center gap-1 font-bold text-live">
            <span className="live-dot rounded-full" aria-hidden />
            {m.progress?.displayClock || m.statusText || 'LIVE'}
          </span>
        ) : (
          <span className="shrink-0">
            {finished ? (
              m.statusText || 'FT'
            ) : m.kickoff ? (
              <LocalTime
                date={m.kickoff}
                options={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              />
            ) : (
              ''
            )}
          </span>
        )}
      </div>
      <TeamRow name={m.homeName} flag={m.homeFlag} score={showScore ? m.homeScore : null} />
      <TeamRow name={m.awayName} flag={m.awayFlag} score={showScore ? m.awayScore : null} />
    </a>
  );
}

export default function HomeView({
  news,
  initialScores,
}: {
  news: NewsItem[];
  initialScores?: TickerMatch[];
}) {
  const { items: scores } = useTicker(initialScores);
  const matches = useMemo(
    () =>
      [...scores].sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0),
      ),
    [scores],
  );
  const [lead, ...rest] = news;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-section px-page-x py-page-y md:px-page-x-md">
      {matches.length > 0 && (
        <section className="space-y-2">
          <h2 className="ds-caption uppercase tracking-[0.2em] text-chalkdim">Today's matches</h2>
          {/* A scroll rail, not a marquee: these cards are links, and chasing a
              moving target is hostile. Also sidesteps the marquee's duplicated
              (aria-hidden but focusable) second copy. */}
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto no-scrollbar">
            {matches.map((m) => (
              <ScoreCard key={`${m.comp}-${m.id}`} m={m} />
            ))}
          </div>
        </section>
      )}

      {news.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">No news right now</p>
      ) : (
        <div className="space-y-3">
          {lead && <NewsCard item={lead} variant="lead" />}
          {rest.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((item, i) => (
                <NewsCard key={item.id || `home-news-${i}`} item={item} variant="standard" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
