import { useNews } from '../hooks/useNews';
import { useTicker } from '../hooks/useTicker';
import type { NewsItem } from '../types';
import NewsRightRail from './NewsRightRail';

interface Props {
  comp: string;
  /** SSR-seeded league headlines for the same competition's news feed. */
  initialNews?: NewsItem[];
}

export default function NewsRightRailIsland({ comp, initialNews }: Props) {
  // Top Headlines use the active competition's league feed; seed when the page
  // already fetched it so we avoid a duplicate cold fetch + loading flash.
  const { items: trending, loading: newsLoading } = useNews(comp, initialNews);
  // Shares the module-level poller with the global Ticker strip.
  const { items: scores, loading: scoresLoading } = useTicker();

  return (
    <NewsRightRail
      trending={trending.slice(0, 5)}
      scores={scores}
      newsLoading={newsLoading}
      scoresLoading={scoresLoading}
    />
  );
}
