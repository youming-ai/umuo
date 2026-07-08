import type { NewsItem, NewsScope } from '../types';
import NewsView from './NewsView';
import AppProviders from './AppProviders';

// Thin island wrapper for news pages. Wraps <NewsView> with the shared
// providers so i18n (useT) works inside the island. Previously, providers
// came from AppIsland via the catch-all; now each island is self-contained.
export default function NewsIsland({
  scope,
  initialData,
}: {
  scope: NewsScope;
  initialData?: NewsItem[];
}) {
  return (
    <AppProviders>
      <NewsView scope={scope} initialData={initialData} />
    </AppProviders>
  );
}
