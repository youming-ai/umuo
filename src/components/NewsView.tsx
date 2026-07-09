import { NEWS_NAV } from '../newsFeed';
import type { NewsItem, NewsScope, NewsTag } from '../types';
import { pathFor } from '../utils/router';
import { useNews } from '../hooks/useNews';
import { DEFAULT_COMPETITION } from '../competitions';

export default function NewsView({
  scope,
  initialData,
}: {
  scope: NewsScope;
  initialData?: NewsItem[];
}) {
  const { items, loading, error, refetch } = useNews(scope, initialData);
  const activePath = pathFor({ kind: 'news', comp: DEFAULT_COMPETITION, scope });

  return (
    <div className="w-full">
      {/* Category-nav strip — real links for middle-click / open-in-new-tab */}
      <nav
        aria-label="News"
        className="ds-segmented mb-4 max-w-full overflow-x-auto no-scrollbar"
      >
        {NEWS_NAV.map((item) => {
          const href = pathFor({ kind: 'news', comp: DEFAULT_COMPETITION, scope: item.scope });
          const active = href === activePath;
          return (
            <a
              key={item.key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap ds-seg-tab ${active ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'}`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      {loading && items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">Loading…</p>
      ) : error && items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="ds-caption text-live mb-3">{error}</p>
          <button
            type="button"
            onClick={refetch}
            className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide rounded-card hover:brightness-110 transition"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">No news right now</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <NewsCard key={item.id || `news-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const external = item.link.startsWith('https://');
  const body = (
    <>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          className="w-full aspect-video object-cover"
          loading="lazy"
        />
      )}
      <div className="p-3">
        <h3 className="font-display font-semibold text-sm text-chalk leading-snug line-clamp-2">
          {item.headline}
        </h3>
        {item.description && (
          <p className="mt-1 font-body text-xs text-chalkdim line-clamp-2">{item.description}</p>
        )}
        {item.byline && <p className="mt-2 ds-caption text-chalkdim/70">{item.byline}</p>}
      </div>
    </>
  );

  return (
    <article className="ds-glass rounded-card shadow-panel overflow-hidden flex flex-col">
      {external ? (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block hover:opacity-95 transition"
        >
          {body}
        </a>
      ) : (
        <div className="block hover:opacity-95 transition">{body}</div>
      )}
      {item.tags.length > 0 && (
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
          {item.tags.map((tag, i) => (
            <Tag
              // biome-ignore lint/suspicious/noArrayIndexKey: tags are deduped so index is stable
              key={`${tag.kind}:${tag.label}:${i}`}
              tag={tag}
            />
          ))}
        </div>
      )}
    </article>
  );
}

// team tags are clickable (→ that team's news feed); athlete/league are labels
// only, because /api/news can't filter on them.
function Tag({ tag }: { tag: NewsTag }) {
  const cls = 'ds-caption rounded-micro px-1.5 py-0.5 bg-white/5';
  if (tag.kind === 'team' && tag.team) {
    return (
      <a
        href={pathFor({
          kind: 'news',
          comp: DEFAULT_COMPETITION,
          scope: { by: 'team', team: tag.team },
        })}
        className={`${cls} text-chalk hover:bg-white/10 transition`}
      >
        {tag.label}
      </a>
    );
  }
  return <span className={`${cls} text-chalkdim`}>{tag.label}</span>;
}