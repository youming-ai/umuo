import type { NewsItem } from '../types';
import AppProviders from './AppProviders';
import NewsCard from './NewsCard';

// Center column of the global home: the aggregated cross-comp news feed.
// League switching lives in the left rail (HomeNav) + the Header; scores +
// top headlines in the right rail (HomeRightRail).
function HomeInner({ news }: { news: NewsItem[] }) {
  if (news.length === 0) {
    return <p className="ds-caption text-chalkdim py-12 text-center">No news right now</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {news.map((item, i) => (
        <NewsCard key={item.id || `home-news-${i}`} item={item} />
      ))}
    </div>
  );
}

export default function HomeView({ news }: { news: NewsItem[] }) {
  return (
    <AppProviders>
      <HomeInner news={news} />
    </AppProviders>
  );
}
