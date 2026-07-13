import type { NewsItem } from '../types';
import NewsView from './NewsView';
import AppProviders from './AppProviders';

// Thin island wrapper for news pages. Wraps <NewsView> with the shared
// providers so theme context works inside the island. Previously, providers
// came from AppIsland via the catch-all; now each island is self-contained.
export default function NewsIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData?: NewsItem[];
}) {
  return (
    <AppProviders>
      <NewsView comp={comp} initialData={initialData} />
    </AppProviders>
  );
}
