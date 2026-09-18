import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_GROUPS } from '../../categories';
import { GLOBAL_FEED_LABEL } from '../../site';
import type { ExploreFeed, ExploreFilterOption, ExploreFilterSet } from '../../types';
import Logo from '../Logo';
import ThemeSwitcher from '../ThemeSwitcher';
import ExploreCard from './ExploreCard';

// Multi-column masonry approximation. column-fill: balance evens the column
// heights as items are appended; tailwind has no built-in for it.
const MASONRY_CLASS =
  'columns-1 gap-3 p-3 [column-fill:balance] md:columns-2 xl:columns-3 2xl:columns-4';

interface ExploreQueryState {
  category: string;
  q: string;
  /** Opaque page boundary from the API; '' means the first page. */
  cursor: string;
}

type ViewMode = 'grid' | 'list';

function queryKey(query: ExploreQueryState): string {
  return JSON.stringify(query);
}

function feedKey(query: ExploreQueryState): string {
  return queryKey({ ...query, cursor: '' });
}

function apiUrl(query: ExploreQueryState): string {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', '24');
  return `/api/explore?${params}`;
}

/** One category link in the rail. */
function SkeletonCards({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items have no identity
        <div key={index} className="mb-3 h-56 animate-pulse rounded-card bg-overlay/5" />
      ))}
    </>
  );
}

function FilterRow({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number | null;
  active: boolean;
  href: string;
}) {
  const className = `flex w-full items-center gap-2 rounded-card-inset px-2 py-1.5 text-left ds-caption min-h-7 ${
    active
      ? 'bg-pitch/15 font-bold text-pitch'
      : 'text-chalkdim hover:bg-overlay/5 hover:text-chalk'
  }`;
  return (
    <a href={href} aria-current={active ? 'page' : undefined} className={className}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== null && <span className="shrink-0 tabular-nums opacity-70">{count}</span>}
    </a>
  );
}

/** Category rail: one All row, then the registry's group sections in display
 *  order. Registry joins are static on both server and client, so SSR and
 *  hydration render identically. */
function CategoryRail({
  options,
  value,
  hrefFor,
}: {
  options: ExploreFilterOption[];
  value: string;
  hrefFor: (value: string) => string;
}) {
  // Unknown counts sum to null, not zero: an outage should leave the label bare
  // rather than assert the site holds no links. An empty list is the opposite
  // case — a successful count over an empty corpus — and is known to be zero,
  // which `every` on an empty array would otherwise report as "all unknown".
  const known = options.map((option) => option.count);
  const total =
    options.length === 0
      ? 0
      : known.every((count) => count === null)
        ? null
        : known.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const groups = CATEGORY_GROUPS.map((group) => ({
    ...group,
    options: options.filter((option) => CATEGORIES[option.value]?.group === group.key),
  })).filter((group) => group.options.length > 0);
  return (
    <div>
      <div>
        <p className="px-2 pb-1 ds-micro uppercase tracking-caption text-chalkdim">Topics</p>
        <FilterRow label={GLOBAL_FEED_LABEL} count={total} active={!value} href={hrefFor('')} />
      </div>
      {groups.map((group) => (
        <div key={group.key}>
          <p className="px-2 pt-3 pb-1 ds-micro uppercase tracking-caption text-chalkdim">
            {group.label}
          </p>
          {group.options.map((option) => (
            <FilterRow
              key={option.value}
              label={option.label}
              count={option.count}
              active={value === option.value}
              href={hrefFor(option.value)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ExploreView({
  initialData,
  initialFilters,
  initialCategory = '',
  initialSearch = '',
}: {
  initialData: ExploreFeed;
  initialFilters: ExploreFilterSet;
  initialCategory?: string;
  initialSearch?: string;
}) {
  const initialQuery: ExploreQueryState = {
    category: initialCategory,
    q: initialSearch,
    cursor: '',
  };
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const initialKey = useRef(queryKey(initialQuery));
  const [loadedFeedKey, setLoadedFeedKey] = useState(() => feedKey(initialQuery));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const key = useMemo(() => queryKey(query), [query]);
  const currentFeedKey = useMemo(() => feedKey(query), [query]);

  // Category pages carry a scope label for the mobile disclosure; the header
  // bar itself stays a four-element strip: logo, search, layout, theme.
  const scopeLabel = initialCategory ? (CATEGORIES[initialCategory]?.label ?? initialCategory) : '';

  useEffect(() => {
    if (initialKey.current === key) {
      initialKey.current = '';
      return;
    }

    const controller = new AbortController();
    const requestFeedKey = currentFeedKey;
    const isFirstPage = !query.cursor;
    if (isFirstPage) setNextCursor(null);
    setLoading(true);
    setError('');
    fetch(apiUrl(query), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The news feed is temporarily unavailable.');
        return (await response.json()) as ExploreFeed;
      })
      .then((feed) => {
        if (controller.signal.aborted) return;
        setItems((previous) => (query.cursor ? [...previous, ...feed.items] : feed.items));
        setNextCursor(feed.nextCursor);
        setLoadedFeedKey(requestFeedKey);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load the news feed.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [currentFeedKey, key, query]);

  // Infinite scroll: re-running on [nextCursor, loading] is what makes it
  // repeat. Appending rows fires no new intersection event, so the observer is
  // rebuilt after each page.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || nextCursor === null || loading || loadedFeedKey !== currentFeedKey) return;
    const cursor = nextCursor;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setQuery((previous) => ({ ...previous, cursor }));
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentFeedKey, loadedFeedKey, loading, nextCursor]);

  // Search is a normal GET navigation: the form submits to the hub URL and
  // clearing is a real link back to it. The document reload keeps the SSR
  // payload and island state on the same query instead of mutating history
  // from the client.
  const hubHref = initialCategory ? `/${initialCategory}` : '/';
  const activeFacets: { key: string; label: string; href: string }[] = [];
  if (query.q) {
    activeFacets.push({ key: `q:${query.q}`, label: `“${query.q}”`, href: hubHref });
  }

  // An outage is either what SSR was handed ("unavailable") or what a client
  // fetch reported (its message set in `error`) — neither is an empty corpus.
  const unavailable = Boolean(initialData.unavailable) || (error !== '' && items.length === 0);

  const rail: ReactNode = (
    <CategoryRail
      options={initialFilters.categories}
      value={initialCategory}
      hrefFor={(value) => (value ? `/${value}` : '/')}
    />
  );

  const feed =
    loading && items.length === 0 ? (
      <div className={MASONRY_CLASS} role="status">
        <span className="sr-only">Loading explore links</span>
        <SkeletonCards count={8} />
      </div>
    ) : items.length === 0 && unavailable ? (
      <p className="p-16 text-center ds-body text-chalkdim">
        The explore feed is temporarily unavailable. Reload in a moment.
      </p>
    ) : items.length === 0 ? (
      <p className="p-16 text-center ds-body text-chalkdim">
        No links match these filters. Clear one to widen the explore feed.
      </p>
    ) : viewMode === 'list' ? (
      <ol className="divide-y divide-line/30 border-b border-line/30" aria-label="Explore links">
        {items.map((article) => (
          <ExploreCard key={article.id} article={article} variant="list" />
        ))}
      </ol>
    ) : (
      // Native CSS multi-column, not a masonry lib. Fills column-major
      // (items 1..n down column 1); swap in an SSR round-robin split if
      // reading order ever has to be exact.
      <section className={MASONRY_CLASS} aria-label="Explore links">
        {items.map((article) => (
          <ExploreCard key={article.id} article={article} />
        ))}
      </section>
    );

  return (
    <div className="desk-shell">
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line/40 bg-night/95 px-3 py-1.5 backdrop-blur-md lg:h-[var(--h-bar)] lg:flex-nowrap lg:py-0">
        <Logo />

        <form
          method="get"
          action={hubHref}
          className="relative flex min-w-0 flex-1 sm:max-w-md lg:ml-8 lg:mr-auto lg:max-w-sm"
        >
          <label className="sr-only" htmlFor="explore-search">
            Search explore links
          </label>
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chalkdim">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="6" />
              <path d="m14.5 14.5 3.5 3.5" />
            </svg>
          </span>
          <input
            id="explore-search"
            name="q"
            defaultValue={initialSearch}
            placeholder="Search stories"
            enterKeyHint="search"
            className="ds-input max-sm:text-base min-h-9 min-w-0 flex-1 py-1 pl-8"
          />
        </form>

        <div className="flex items-center gap-2 lg:ml-auto">
          <fieldset className="ds-segmented shrink-0">
            <legend className="sr-only">Feed layout</legend>
            <button
              type="button"
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              className={`ds-seg-tab min-h-7 px-3 text-xs ${viewMode === 'grid' ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'}`}
            >
              Grid
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={`ds-seg-tab min-h-7 px-3 text-xs ${viewMode === 'list' ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'}`}
            >
              List
            </button>
          </fieldset>

          <ThemeSwitcher />
        </div>
      </div>

      {activeFacets.length > 0 && (
        <nav
          className="flex flex-wrap items-center gap-2 border-b border-line/40 bg-night/40 px-3 py-2 ds-caption text-chalkdim"
          aria-label="Active filters"
        >
          <span className="uppercase tracking-caption">Filtering by</span>
          {activeFacets.map((facet) => (
            <a
              key={facet.key}
              href={facet.href}
              className="inline-flex items-center gap-1 rounded-pill border border-line/40 bg-panel/70 px-2 py-0.5 uppercase tracking-caption hover:border-pitch/50 hover:text-chalk ds-press"
            >
              <span>{facet.label}</span>
              <span aria-hidden="true">×</span>
              <span className="sr-only">Remove {facet.label} filter</span>
            </a>
          ))}
          <a
            href={hubHref}
            className="ml-auto uppercase tracking-caption text-pitch underline-offset-4 hover:underline"
          >
            Clear all
          </a>
        </nav>
      )}

      <div className="flex">
        <aside className="no-scrollbar sticky top-[var(--h-bar)] hidden h-[calc(100vh-var(--h-bar))] w-52 shrink-0 self-start overflow-y-auto border-r border-line/40 p-2 lg:block">
          {rail}
        </aside>

        <div className="min-w-0 flex-1">
          {/* <details> is the native disclosure — no state, no outside-click handler. */}
          <details className="border-b border-line/40 lg:hidden">
            <summary className="cursor-pointer list-none px-3 py-2 ds-caption uppercase tracking-caption text-chalkdim [&::-webkit-details-marker]:hidden">
              Categories {initialCategory ? `· ${scopeLabel}` : ''}
            </summary>
            <div className="p-2">{rail}</div>
          </details>

          {/* Only for the append path: a first-page failure is the empty state
              below, and showing both would say the same thing twice. */}
          {error && items.length > 0 && (
            <p role="alert" className="px-3 py-2 ds-caption text-live">
              {error}
            </p>
          )}

          {/* The skip link's target. It has to exist in every state, including
              the empty and unavailable ones, so it lives on this wrapper rather
              than on the grid/list inside `feed`. tabIndex -1 keeps it out of
              the tab order while letting the link move focus here. */}
          <div id="explore-results" tabIndex={-1}>
            {feed}
          </div>

          {/* First-load skeleton lives inside `feed`; this covers the append
              path during infinite scroll and filter changes (items still
              present, rootMargin fires well before the bottom button). */}
          {loading && items.length > 0 && (
            <div className={MASONRY_CLASS} role="status" aria-live="polite">
              <span className="sr-only">Loading more stories</span>
              <SkeletonCards count={4} />
            </div>
          )}

          {/* Auto-load covers scrolling; the button is the keyboard / no-IO path. */}
          <div ref={sentinelRef} className="flex justify-center py-6" aria-live="polite">
            {nextCursor !== null ? (
              <button
                type="button"
                onClick={() => setQuery((previous) => ({ ...previous, cursor: nextCursor }))}
                disabled={loading}
                className="ds-btn-secondary"
              >
                {loading ? 'Loading…' : 'Load more stories'}
              </button>
            ) : items.length > 0 ? (
              <p className="ds-caption uppercase tracking-caption text-chalkdim">End of the feed</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
