import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FOOTBALL_COMPETITIONS } from '../../competitions';
import type { ExploreFeed, ExploreFilterOption, ExploreFilterSet } from '../../types';
import Logo from '../Logo';
import ThemeSwitcher from '../ThemeSwitcher';
import ExploreCard from './ExploreCard';

interface ExploreQueryState {
  comp: string;
  source: string;
  tag: string;
  q: string;
  /** Opaque page boundary from the API; '' means the first page. */
  cursor: string;
}

type ViewMode = 'grid' | 'list';
/** `comp` is not here: it comes from the route, not from in-page state. */
type FilterField = 'source' | 'tag';

function queryKey(query: ExploreQueryState): string {
  return JSON.stringify(query);
}

function apiUrl(query: ExploreQueryState): string {
  const params = new URLSearchParams();
  if (query.comp) params.set('comp', query.comp);
  if (query.source) params.set('source', query.source);
  if (query.tag) params.set('tag', query.tag);
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', '24');
  return `/api/explore?${params}`;
}

/** One index row in the rail: label left, count right, active row filled. */
function FilterRow({
  label,
  count,
  active,
  href,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = `flex w-full items-center gap-2 rounded-card-inset px-2 py-1 text-left ds-caption ${
    active
      ? 'bg-pitch/15 font-bold text-pitch'
      : 'text-chalkdim hover:bg-overlay/5 hover:text-chalk'
  }`;
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== null && <span className="shrink-0 tabular-nums opacity-70">{count}</span>}
    </>
  );
  // A competition is a route, not a filter — it gets a real link so the URL,
  // the title and a refresh all agree. Sources and topics stay in-page state.
  return href ? (
    <a href={href} aria-current={active ? 'page' : undefined} className={className}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {body}
    </button>
  );
}

function FilterGroup({
  title,
  allLabel,
  options,
  value,
  onChange,
  hrefFor,
}: {
  title: string;
  allLabel: string;
  options: ExploreFilterOption[];
  value: string;
  onChange?: (value: string) => void;
  hrefFor?: (value: string) => string;
}) {
  if (options.length === 0) return null;
  const total = options.reduce((sum, option) => sum + option.count, 0);
  return (
    <div>
      {/* No alpha on the muted token here: chalkdim/70 on the ground is 3.65:1
          (2.93:1 in light), under AA for text this small. */}
      <p className="px-2 pb-1 ds-micro uppercase tracking-caption text-chalkdim">{title}</p>
      <FilterRow
        label={allLabel}
        count={total}
        active={!value}
        href={hrefFor?.('')}
        onClick={() => onChange?.('')}
      />
      {options.map((option) => (
        <FilterRow
          key={option.value}
          label={option.label}
          count={option.count}
          active={value === option.value}
          href={hrefFor?.(option.value)}
          onClick={() => onChange?.(option.value)}
        />
      ))}
    </div>
  );
}

export default function ExploreView({
  initialData,
  initialFilters,
  initialComp = '',
}: {
  initialData: ExploreFeed;
  initialFilters: ExploreFilterSet;
  initialComp?: string;
}) {
  const initialQuery: ExploreQueryState = {
    comp: initialComp,
    source: '',
    tag: '',
    q: '',
    cursor: '',
  };
  const [query, setQuery] = useState(initialQuery);
  const [draftSearch, setDraftSearch] = useState('');
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const initialKey = useRef(queryKey(initialQuery));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const key = useMemo(() => queryKey(query), [query]);

  const isFiltered = Boolean(query.source || query.tag || query.q);
  const scopeLabel = initialComp
    ? (FOOTBALL_COMPETITIONS[initialComp]?.label ?? initialComp)
    : 'All football';

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

  function changeFilter(field: FilterField, value: string) {
    setQuery((previous) => ({ ...previous, [field]: value, cursor: '' }));
  }

  function clearFilters() {
    setDraftSearch('');
    setQuery({ ...initialQuery });
  }

  // Infinite scroll. Re-running on [nextCursor, loading] is what makes it
  // repeat: appending rows fires no new intersection event, so the observer is
  // rebuilt after each page and re-checks whether the sentinel is still in view.
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

  const rail: ReactNode = (
    <div className="space-y-4">
      <FilterGroup
        title="Sources"
        allLabel="All sources"
        options={initialFilters.sources}
        value={query.source}
        onChange={(value) => changeFilter('source', value)}
      />
      <FilterGroup
        title="Competitions"
        allLabel="All football"
        options={initialFilters.competitions}
        value={initialComp}
        hrefFor={(value) => (value ? `/${value}` : '/')}
      />
      <FilterGroup
        title="Topics"
        allLabel="All topics"
        options={initialFilters.tags.slice(0, 16)}
        value={query.tag}
        onChange={(value) => changeFilter('tag', value)}
      />
    </div>
  );

  const feed =
    loading && items.length === 0 ? (
      <div className="columns-1 gap-3 p-3 md:columns-2 xl:columns-3 2xl:columns-4" role="status">
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
      // ponytail: native CSS multi-column, not a masonry lib. Fills column-major
      // (items 1..n down column 1) rather than round-robin across columns —
      // swap in an SSR round-robin split if reading order ever has to be exact.
      <section
        className="columns-1 gap-3 p-3 md:columns-2 xl:columns-3 2xl:columns-4"
        aria-label="Football news"
      >
        {items.map((article) => (
          <ExploreCard key={article.id} article={article} />
        ))}
      </section>
    );

  return (
    <div>
      {/* The one sticky bar on the page — the wordmark and the theme switcher
          live in this row (the shell no longer ships its own header). Pinned to
          --h-bar on lg (guaranteed one row) because the rail sticks below it;
          it wraps freely below lg, where the rail is a drawer and nothing
          offsets by it. */}
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line/40 bg-night/95 px-3 py-1.5 backdrop-blur-md lg:h-[var(--h-bar)] lg:flex-nowrap lg:py-0">
        <Logo />

        <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2 sm:max-w-xs">
          <label className="sr-only" htmlFor="explore-search">
            Search football news
          </label>
          <input
            id="explore-search"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search stories"
            className="ds-input min-h-9 min-w-0 flex-1 py-1"
          />
          <button type="submit" className="ds-btn-secondary min-h-9 shrink-0 px-3 text-sm">
            Search
          </button>
        </form>

        <h1 className="ds-caption truncate uppercase tracking-caption font-bold text-chalk">
          {scopeLabel}
        </h1>
        {isFiltered && (
          <button
            type="button"
            onClick={clearFilters}
            className="ds-caption shrink-0 uppercase tracking-caption text-pitch underline-offset-4 hover:underline"
          >
            Clear
          </button>
        )}

        {/* Decodes the green strip across each card's top edge. A signature
            nobody can read is just a stray 2px of colour. */}
        <p className="ml-auto hidden items-center gap-1.5 ds-caption text-chalkdim xl:flex">
          <span className="h-0.5 w-6 bg-line" aria-hidden="true">
            <span className="block h-full w-2/3 bg-pitch" />
          </span>
          AI signal
        </p>

        <fieldset className="ds-segmented shrink-0 xl:ml-0 ml-auto">
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

      <div className="flex">
        {/* Full-height so the rule down its right edge runs the whole viewport,
            and its own scroll container so a long index never drags the feed. */}
        <aside className="no-scrollbar sticky top-[var(--h-bar)] hidden h-[calc(100vh-var(--h-bar))] w-52 shrink-0 self-start overflow-y-auto border-r border-line/40 p-2 lg:block">
          {rail}
        </aside>

        <div className="min-w-0 flex-1">
          {/* The rail is a drawer on phones. <details> is the native disclosure —
              no state, no outside-click handler, works before hydration. */}
          <details className="border-b border-line/40 lg:hidden">
            <summary className="cursor-pointer list-none px-3 py-2 ds-caption uppercase tracking-caption text-chalkdim [&::-webkit-details-marker]:hidden">
              Filters {isFiltered ? '· on' : ''}
            </summary>
            <div className="p-2">{rail}</div>
          </details>

          {error && <p className="px-3 py-2 ds-caption text-live">{error}</p>}

          {feed}

          {/* ponytail: the button stays alongside the sentinel. Auto-load covers
              scrolling; the button is the keyboard/no-IntersectionObserver path
              and the only way to reach the footer without the feed growing
              underneath you. */}
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
