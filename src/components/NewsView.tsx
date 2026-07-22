import { useCallback, useEffect, useRef, useState } from 'react';
import { useNews } from '../hooks/useNews';
import type { NewsItem } from '../types';
import NewsCard from './NewsCard';

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
            <div className="flex flex-col gap-3">
              {storyItems.map((item, i) => (
                <NewsCard key={item.id || `news-${i}`} item={item} variant="row" />
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
