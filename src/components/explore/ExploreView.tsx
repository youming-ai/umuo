import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FOOTBALL_COMPETITIONS } from '../../competitions';
import type { ExploreFeed, ExploreFilterOption, ExploreFilterSet } from '../../types';
import Logo from '../Logo';

// Multi-column masonry approximation. column-fill: balance evens the column
// heights as items are appended; tailwind has no built-in for it.
const MASONRY_CLASS =
  'columns-1 gap-3 p-3 [column-fill:balance] md:columns-2 xl:columns-3 2xl:columns-4';
import ThemeSwitcher from '../ThemeSwitcher';
import ExploreCard from './ExploreCard';

interface ExploreQueryState {
  comp: string;
  q: string;
  /** Opaque page boundary from the API; '' means the first page. */
  cursor: string;
}

type ViewMode = 'grid' | 'list';

function queryKey(query: ExploreQueryState): string {
  return JSON.stringify(query);
}

function apiUrl(query: ExploreQueryState): string {
  const params = new URLSearchParams();
  if (query.comp) params.set('comp', query.comp);
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', '24');
  return `/api/explore?${params}`;
}

/** One competition category link in the rail. */
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
  const className = `flex w-full items-center gap-2 rounded-card-inset px-2 py-1 text-left ds-caption ${
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

function FilterGroup({
  title,
  allLabel,
  options,
  value,
  hrefFor,
}: {
  title: string;
  allLabel: string;
  options: ExploreFilterOption[];
  value: string;
  hrefFor: (value: string) => string;
}) {
  if (options.length === 0) return null;
  const total = options.reduce((sum, option) => sum + option.count, 0);
  return (
    <div>
      <p className="px-2 pb-1 ds-micro uppercase tracking-caption text-chalkdim">{title}</p>
      <FilterRow label={allLabel} count={total} active={!value} href={hrefFor('')} />
      {options.map((option) => (
        <FilterRow
          key={option.value}
          label={option.label}
          count={option.count}
          active={value === option.value}
          href={hrefFor(option.value)}
        />
      ))}
    </div>
  );
}

export default function ExploreView({
  initialData,
  initialFilters,
  initialComp = '',
  initialSearch = '',
}: {
  initialData: ExploreFeed;
  initialFilters: ExploreFilterSet;
  initialComp?: string;
  initialSearch?: string;
}) {
  const initialQuery: ExploreQueryState = {
    comp: initialComp,
    q: initialSearch,
    cursor: '',
  };
  const [query, setQuery] = useState(initialQuery);
  const [draftSearch, setDraftSearch] = useState(initialSearch);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const initialKey = useRef(queryKey(initialQuery));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const key = useMemo(() => queryKey(query), [query]);

  // Competition pages carry a scope label; the global home is implicit in the wordmark.
  const scopeLabel = initialComp ? (FOOTBALL_COMPETITIONS[initialComp]?.label ?? initialComp) : '';

  useEffect(() => {
    if (initialKey.current === key) {
      initialKey.current = '';
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(apiUrl(query), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The news feed is temporarily unavailable.');
        return (await response.json()) as ExploreFeed;
      })
      .then((feed) => {
        setItems((previous) => (query.cursor ? [...previous, ...feed.items] : feed.items));
        setNextCursor(feed.nextCursor);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load the news feed.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, query]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery((previous) => ({ ...previous, q: draftSearch.trim(), cursor: '' }));
  }

  function clearFilters() {
    setDraftSearch('');
    setQuery({ ...initialQuery });
  }

  // Infinite scroll: re-running on [nextCursor, loading] is what makes it
  // repeat. Appending rows fires no new intersection event, so the observer is
  // rebuilt after each page.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || nextCursor === null || loading) return;
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
  }, [nextCursor, loading]);

  // User-driven active search facet.
  const activeFacets: { key: string; label: string; onClear: () => void }[] = [];
  if (query.q) {
    activeFacets.push({
      key: `q:${query.q}`,
      label: `“${query.q}”`,
      onClear: () => {
        setDraftSearch('');
        setQuery((previous) => ({ ...previous, q: '', cursor: '' }));
      },
    });
  }

  const rail: ReactNode = (
    <div>
      <FilterGroup
        title="Competitions"
        allLabel="All football"
        options={initialFilters.competitions}
        value={initialComp}
        hrefFor={(value) => (value ? `/${value}` : '/')}
      />
    </div>
  );

  const feed =
    loading && items.length === 0 ? (
      <div className={MASONRY_CLASS} role="status">
        <span className="sr-only">Loading football news</span>
        {Array.from({ length: 8 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items have no identity
          <div key={index} className="mb-3 h-56 animate-pulse rounded-card bg-overlay/5" />
        ))}
      </div>
    ) : items.length === 0 ? (
      <p className="p-16 text-center ds-body text-chalkdim">
        No stories match these filters. Clear one to widen the desk.
      </p>
    ) : viewMode === 'list' ? (
      <ol className="divide-y divide-line/30 border-b border-line/30" aria-label="Football news">
        {items.map((article) => (
          <ExploreCard key={article.id} article={article} variant="list" />
        ))}
      </ol>
    ) : (
      // Native CSS multi-column, not a masonry lib. Fills column-major
      // (items 1..n down column 1); swap in an SSR round-robin split if
      // reading order ever has to be exact.
      <section className={MASONRY_CLASS} aria-label="Football news">
        {items.map((article) => (
          <ExploreCard key={article.id} article={article} />
        ))}
      </section>
    );

  return (
    <div>
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line/40 bg-night/95 px-3 py-1.5 backdrop-blur-md lg:h-[var(--h-bar)] lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {scopeLabel && (
            <>
              <span className="h-4 w-px bg-line/40" aria-hidden="true" />
              <h1 className="ds-caption truncate uppercase tracking-caption font-bold text-chalk">
                {scopeLabel}
              </h1>
            </>
          )}
        </div>

        <form
          onSubmit={submitSearch}
          className="relative flex min-w-0 flex-1 sm:max-w-md lg:mx-auto lg:max-w-xl"
        >
          <label className="sr-only" htmlFor="explore-search">
            Search football news
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
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search stories"
            enterKeyHint="search"
            className="ds-input min-h-9 min-w-0 flex-1 py-1 pl-8"
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
            <button
              key={facet.key}
              type="button"
              onClick={facet.onClear}
              className="inline-flex items-center gap-1 rounded-pill border border-line/40 bg-panel/70 px-2 py-0.5 uppercase tracking-caption hover:border-pitch/50 hover:text-chalk ds-press"
            >
              <span>{facet.label}</span>
              <span aria-hidden="true">×</span>
              <span className="sr-only">Remove {facet.label} filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto uppercase tracking-caption text-pitch underline-offset-4 hover:underline"
          >
            Clear all
          </button>
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
              Competitions {initialComp ? `· ${scopeLabel}` : ''}
            </summary>
            <div className="p-2">{rail}</div>
          </details>

          {error && <p className="px-3 py-2 ds-caption text-live">{error}</p>}

          {feed}

          {/* First-load skeleton lives inside `feed`; this covers the append
              path during infinite scroll and filter changes (items still
              present, rootMargin fires well before the bottom button). */}
          {loading && items.length > 0 && (
            <div className={MASONRY_CLASS} role="status" aria-live="polite">
              <span className="sr-only">Loading more stories</span>
              {Array.from({ length: 4 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items have no identity
                <div key={index} className="mb-3 h-56 animate-pulse rounded-card bg-overlay/5" />
              ))}
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
