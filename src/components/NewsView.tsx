import { useCallback, useEffect, useRef, useState } from 'react';
import { useNews } from '../hooks/useNews';
import type { NewsItem, NewsTag } from '../types';

const PAGE_SIZE = 12;

export default function NewsView({
  comp,
  initialData,
}: {
  comp: string;
  initialData?: NewsItem[];
}) {
  const { items, loading, error, refetch } = useNews(comp, initialData);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count on competition switch — NOT on [items], which gets a new
  // array ref on every poll/refocus and would snap the user back to page 1.
  // biome-ignore lint/correctness/useExhaustiveDependencies: comp is intentionally the only trigger; resetting when it changes keeps pagination aligned with the new feed.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [comp]);

  // IntersectionObserver on the sentinel — reveal the next batch when it enters viewport
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallback = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => prev + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' },
    );
    observerRef.current.observe(node);
  }, []);

  const leadItem = items[0];
  const storyItems = items.slice(1, visibleCount);
  const hasMore = visibleCount < items.length;

  return (
    <div className="w-full">
      {loading && items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">Loading…</p>
      ) : error && items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="ds-caption text-live mb-3">{error}</p>
          <button
            type="button"
            onClick={refetch}
            className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide rounded-card hover:brightness-110 ds-press"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="ds-caption text-chalkdim py-12 text-center">No news right now</p>
      ) : (
        <div className="space-y-3">
          {leadItem && <NewsCard item={leadItem} variant="lead" />}
          {storyItems.length > 0 && (
            <div className="columns-1 gap-3 sm:columns-2 xl:columns-3 2xl:columns-4">
              {storyItems.map((item, i) => (
                <div key={item.id || `news-${i}`} className="mb-3 break-inside-avoid">
                  <NewsCard item={item} />
                </div>
              ))}
            </div>
          )}
          {hasMore && (
            <div ref={sentinelCallback} className="flex justify-center py-6">
              <span className="ds-caption text-chalkdim">Loading more…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewsCard({
  item,
  variant = 'standard',
}: {
  item: NewsItem;
  variant?: 'standard' | 'lead';
}) {
  const external = item.link.startsWith('https://');
  const linked = external || item.link.startsWith('/');
  const isLead = variant === 'lead';
  const body = (
    <div className={isLead ? 'md:flex' : undefined}>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className={`w-full object-cover ${
            isLead ? 'aspect-[16/9] md:aspect-auto md:h-full md:w-1/2' : 'aspect-video'
          }`}
          loading={isLead ? 'eager' : 'lazy'}
        />
      )}
      <div className={isLead ? 'p-4 md:flex md:w-1/2 md:flex-col md:justify-center md:p-5' : 'p-3'}>
        <h3
          className={`font-display font-semibold text-chalk leading-snug ${
            isLead ? 'text-xl line-clamp-3 md:text-2xl' : 'text-sm line-clamp-2'
          }`}
        >
          {item.headline}
        </h3>
        {item.description && (
          <p
            className={`mt-1 font-body text-chalkdim ${
              isLead ? 'text-sm line-clamp-3 md:text-base' : 'text-xs line-clamp-2'
            }`}
          >
            {item.description}
          </p>
        )}
        {item.byline && <p className="mt-2 ds-caption text-chalkdim">{item.byline}</p>}
      </div>
    </div>
  );

  return (
    <article className="ds-glass rounded-card shadow-panel overflow-hidden">
      {linked ? (
        <a
          href={item.link}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="block hover:opacity-95 transition-opacity duration-150 ease-out"
        >
          {body}
        </a>
      ) : (
        <div>{body}</div>
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

// All tags render as plain labels. News is now per-competition (site.api league
// feed); there is no team-scoped news route to link into.
function Tag({ tag }: { tag: NewsTag }) {
  const cls = 'ds-caption rounded-micro px-1.5 py-0.5 bg-white/5';
  return <span className={`${cls} text-chalkdim`}>{tag.label}</span>;
}
