import { COMPETITIONS } from '../competitions';
import type { NewsItem } from '../types';
import AppProviders from './AppProviders';
import NewsCard from './NewsCard';

function HomeInner({ news }: { news: NewsItem[] }) {
  return (
    <div className="space-y-section">
      {/* Per-competition entry cards. The cross-comp scores strip is the
          Layout's Ticker, which already fans out across all competitions. */}
      <nav aria-label="Competitions" className="flex flex-wrap gap-2">
        {Object.values(COMPETITIONS).map((c) => (
          <a
            key={c.key}
            href={`/${c.key}`}
            className="rounded-card bg-overlay/5 px-4 py-2 font-display text-sm text-chalk hover:bg-overlay/10 ds-press"
          >
            {c.label}
          </a>
        ))}
      </nav>

      {news.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">No news right now</p>
      ) : (
        <div className="columns-1 gap-3 sm:columns-2 xl:columns-3 2xl:columns-4">
          {news.map((item, i) => (
            <div key={item.id || `home-news-${i}`} className="mb-3 break-inside-avoid">
              <NewsCard item={item} />
            </div>
          ))}
        </div>
      )}
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
