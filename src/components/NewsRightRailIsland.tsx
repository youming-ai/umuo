import { useNews } from '../hooks/useNews';
import { useTicker } from '../hooks/useTicker';
import type { NewsItem } from '../types';
import AppProviders from './AppProviders';
import NewsRightRail from './NewsRightRail';

interface Props {
  /** SSR-seeded global headlines when the main column is also `by: 'all'`. */
  initialNews?: NewsItem[];
}

export default function NewsRightRailIsland({ initialNews }: Props) {
  // Top Headlines always use the global feed; seed when the page already
  // fetched it so we avoid a duplicate cold fetch + loading flash on /news.
  const { items: trending, loading: newsLoading } = useNews({ by: 'all' }, initialNews);
  // Shares the module-level poller with the global Ticker strip.
  const { items: scores, loading: scoresLoading } = useTicker();

  return (
    <AppProviders>
      <NewsRightRail
        trending={trending.slice(0, 5)}
        scores={scores}
        newsLoading={newsLoading}
        scoresLoading={scoresLoading}
      />
    </AppProviders>
  );
}
