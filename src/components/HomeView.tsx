import type { NewsItem } from '../types';
import NewsCard from './NewsCard';

// Center column of the global home: the aggregated cross-comp news feed.
// League switching lives in the Header top nav; scores + top headlines in the
// right rail (HomeRightRail).
function HomeInner({ news }: { news: NewsItem[] }) {
  if (news.length === 0) {
    return <p className="ds-caption text-chalkdim py-12 text-center">No news right now</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {news.map((item, i) => (
        <NewsCard key={item.id || `home-news-${i}`} item={item} variant="row" />
      ))}
    </div>
  );
}

export default function HomeView({ news }: { news: NewsItem[] }) {
  return <HomeInner news={news} />;
}
