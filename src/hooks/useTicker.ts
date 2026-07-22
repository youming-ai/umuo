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
    const batches = await Promise.all(
      comps.map(async (comp) => {
        const res = await fetch(`/api/${comp}/scoreboard`, { signal });
        if (!res.ok) return [] as TickerMatch[];
        const json = await res.json();
        const { matches } = getAdapter(comp).transform(json, {});
        return matches.map((m) => ({ ...m, comp }));
      }),
    );
    if (signal.aborted) return;
    const merged = batches.flat();
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
  if (initialScores && initialScores.length > 0 && shared.items.length === 0) {
    shared = { items: marqueeMatches(initialScores, Date.now()) as TickerMatch[], loading: false };
  }
  const [state, setState] = useState<TickerState>(shared);
  useEffect(() => {
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    startPolling();
    // Sync in case another island already populated shared state.
    setState(shared);
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
}
