import { useNews } from '../hooks/useNews';
import { useTicker } from '../hooks/useTicker';
import AppProviders from './AppProviders';
import NewsRightRail from './NewsRightRail';

export default function NewsRightRailIsland() {
  const { items: trending } = useNews({ by: 'all' });
  const { items: scores } = useTicker();

  return (
    <AppProviders>
      <NewsRightRail trending={trending.slice(0, 5)} scores={scores} />
    </AppProviders>
  );
}