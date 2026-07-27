import { useEffect, useState } from 'react';
import { getAdapter } from '../adapters';
import { COMPETITIONS } from '../competitions';
import type { CompMatch } from '../types';
import { marqueeMatches } from '../utils/marquee';

export type TickerMatch = CompMatch & { comp: string };

export type TickerState = {
  items: TickerMatch[];
  loading: boolean;
};

// Module-level shared poller so multiple islands (global Ticker strip + news
// right-rail scores) share one scoreboard fan-out instead of each running their
// own 30s loop. React state is per-island; this map is per-document.
type Listener = (state: TickerState) => void;

let shared: TickerState = { items: [], loading: true };
const listeners = new Set<Listener>();
let started = false;
let abortRef: AbortController | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let onVisibility: (() => void) | null = null;

// Set once a fan-out actually received successful upstream responses. It is
// distinct from `shared.loading === false`, which also happens when the catch
// path gives up after a failure. We need to know whether an empty board is
// authoritative (successful empty poll) or just "no data yet" (failure).
type BatchResult = { ok: true; matches: TickerMatch[] } | { ok: false };

let hasSuccessfulPoll = false;

function publish(next: TickerState) {
  shared = next;
  for (const listener of listeners) listener(shared);
}

async function fetchAll() {
  abortRef?.abort();
  const controller = new AbortController();
  abortRef = controller;
  const { signal } = controller;

  try {
    const comps = Object.keys(COMPETITIONS);
    const batchResults = await Promise.allSettled(
      comps.map(async (comp) => {
        const res = await fetch(`/api/${comp}/scoreboard`, { signal });
        if (!res.ok) return { ok: false as const };
        const json = await res.json();
        const { matches } = getAdapter(comp).transform(json, {});
        return { ok: true as const, matches: matches.map((m) => ({ ...m, comp })) };
      }),
    );
    if (signal.aborted) return;
    // Require the whole fan-out to succeed. Partial success is not enough: an
    // empty 200 from one league while the others 502 would otherwise publish []
    // and lock `hasSuccessfulPoll`, hiding a legitimate seed behind a false
    // "authoritative" empty board.
    const allSucceeded = batchResults.every(
      (r): r is PromiseFulfilledResult<BatchResult & { ok: true }> =>
        r.status === 'fulfilled' && r.value.ok,
    );
    if (!allSucceeded) {
      // Treat partial/outage as failure: keep whatever we have (including a
      // seed) and just drop the spinner.
      publish({ ...shared, loading: false });
      return;
    }
    const merged = batchResults.flatMap(
      (r) => (r as PromiseFulfilledResult<BatchResult & { ok: true }>).value.matches,
    );
    hasSuccessfulPoll = true;
    publish({
      items: marqueeMatches(merged, Date.now()) as TickerMatch[],
      loading: false,
    });
  } catch (err: unknown) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
    console.error('useTicker fetch failed:', err);
    // Keep prior items; only clear the initial loading flag.
    publish({ ...shared, loading: false });
  }
}

function startPolling() {
  if (started) return;
  started = true;
  void fetchAll();
  onVisibility = () => {
    if (document.visibilityState === 'visible') void fetchAll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') void fetchAll();
  }, 30_000);
}

function stopPolling() {
  if (listeners.size > 0) return;
  started = false;
  abortRef?.abort();
  abortRef = null;
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
  }
}

// ponytail: useTicker is intentionally a document-level ref-counted shared poller
// rather than wrapping usePolledResource because multiple islands share one
// cross-competition scoreboard loop.
export function useTicker(initialScores?: TickerMatch[]): TickerState {
  // Seed during render so THIS island paints SSR scores on its first frame.
  // Only touches module state — publishing here would setState other islands
  // mid-render.
  //
  // `shared.loading` was not enough to gate seeding: the catch path sets
  // loading=false after a failed fan-out, and an empty board from a successful
  // fan-out is authoritative on an off day. We track `hasSuccessfulPoll`
  // separately; it is only true once a successful response has been seen.
  if (
    initialScores &&
    initialScores.length > 0 &&
    !hasSuccessfulPoll &&
    shared.items.length === 0
  ) {
    shared = { items: marqueeMatches(initialScores, Date.now()) as TickerMatch[], loading: false };
  }
  const [state, setState] = useState<TickerState>(shared);
  useEffect(() => {
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    startPolling();
    // Islands are separate hydration roots mounting in arbitrary order, so a
    // seeder can arrive after an unseeded island already mounted and read an
    // empty `shared`. Broadcasting (not just self-syncing) hands the seed to
    // those islands too — otherwise they stall on empty until the first poll.
    publish(shared);
    return () => {
      listeners.delete(listener);
      stopPolling();
    };
  }, []);

  return state;
}

/** Test helper — reset module poller between tests. */
export function __resetTickerForTests() {
  listeners.clear();
  stopPolling();
  shared = { items: [], loading: true };
  hasSuccessfulPoll = false;
}
