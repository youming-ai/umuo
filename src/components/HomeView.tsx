import { COMPETITIONS } from '../competitions';
import type { NewsItem } from '../types';
import AppProviders from './AppProviders';

function HomeNewsCard({ item }: { item: NewsItem }) {
  const external = item.link.startsWith('https://');
  const linked = external || item.link.startsWith('/');
  const body = (
    <div>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className="aspect-video w-full object-cover"
        />
      )}
      <div className="p-3">
        <h3 className="font-display text-sm font-semibold leading-snug text-chalk line-clamp-2">
          {item.headline}
        </h3>
        {item.description && (
          <p className="mt-1 font-body text-xs text-chalkdim line-clamp-2">{item.description}</p>
        )}
      </div>
    </div>
  );
  return (
    <article className="ds-glass overflow-hidden rounded-card shadow-panel">
      {linked ? (
        <a
          href={item.link}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="block transition-opacity duration-150 ease-out hover:opacity-95"
        >
          {body}
        </a>
      ) : (
        <div>{body}</div>
      )}
    </article>
  );
}

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
              <HomeNewsCard item={item} />
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
