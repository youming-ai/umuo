import { NEWS_NAV } from '../newsFeed';
import { useT } from '../i18n';
import type { NewsItem, NewsScope, NewsTag } from '../types';
import { navigate, pathFor } from '../utils/router';
import { useNews } from '../hooks/useNews';
import { DEFAULT_COMPETITION } from '../competitions';

export default function NewsView({ scope }: { scope: NewsScope }) {
  const t = useT();
  const { items, loading, error, refetch } = useNews(scope);
  const activePath = pathFor({ kind: 'news', comp: DEFAULT_COMPETITION, scope });

  return (
    <div className="max-w-6xl mx-auto w-full px-page-x md:px-page-x-md py-page-y">
      {/* Category-nav strip */}
      <nav
        aria-label={t('news.title')}
        className="ds-segmented mb-4 max-w-full overflow-x-auto no-scrollbar"
      >
        {NEWS_NAV.map((item) => {
          const active =
            pathFor({ kind: 'news', comp: DEFAULT_COMPETITION, scope: item.scope }) === activePath;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() =>
                navigate(pathFor({ kind: 'news', comp: DEFAULT_COMPETITION, scope: item.scope }), {
                  scroll: true,
                })
              }
              aria-pressed={active}
              className={`whitespace-nowrap ds-seg-tab ${active ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'}`}
            >
              {t(item.labelKey)}
            </button>
          );
        })}
      </nav>

      {loading && items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">{t('common.loading')}</p>
      ) : error && items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="ds-caption text-live mb-3">{error}</p>
          <button
            type="button"
            onClick={refetch}
            className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide rounded-card hover:brightness-110 transition"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">{t('news.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className="ds-glass rounded-card shadow-panel overflow-hidden flex flex-col">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:opacity-95 transition"
      >
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
      </a>
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
      <button
        type="button"
        onClick={() =>
          navigate(
            pathFor({
              kind: 'news',
              comp: DEFAULT_COMPETITION,
              scope: { by: 'team', team: tag.team! },
            }),
            {
              scroll: true,
            },
          )
        }
        className={`${cls} text-chalk hover:bg-white/10 transition`}
      >
        {tag.label}
      </button>
    );
  }
  return <span className={`${cls} text-chalkdim`}>{tag.label}</span>;
}
