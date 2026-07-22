import { type TickerMatch, useTicker } from '../hooks/useTicker';
import type { NewsItem } from '../types';
import AppProviders from './AppProviders';
import NewsRightRail from './NewsRightRail';

// Right rail for the global home. Reuses the presentational NewsRightRail:
// Top Headlines come from the aggregated cross-comp feed (SSR-seeded), Today's
// Scores from the shared cross-comp Ticker poller.
export default function HomeRightRailIsland({
  news,
  initialScores,
}: {
  news: NewsItem[];
  initialScores?: TickerMatch[];
}) {
  const { items: scores, loading: scoresLoading } = useTicker(initialScores);
  return (
    <AppProviders>
      <NewsRightRail trending={news.slice(0, 5)} scores={scores} scoresLoading={scoresLoading} />
    </AppProviders>
  );
}
