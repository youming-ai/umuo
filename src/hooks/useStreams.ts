import { useCallback, useEffect, useRef, useState } from 'react';
import type { Match, Substream } from '../types';
import { slugify } from '../utils/helpers';
import { isTrustedStreamUrl } from '../utils/streamSources';

interface APISub {
  name: string;
  source_tag: string;
  iframe: string;
}
interface APIStream {
  id: number;
  name: string;
  category_name?: string;
  iframe: string;
  viewers?: string;
  poster?: string;
  colors?: string[];
  substreams?: APISub[];
  source_tag?: string;
  tag?: string;
  starts_at?: number;
  ends_at?: number;
  always_live?: number;
}
interface APICategory {
  category?: string;
  streams?: APIStream[];
}
interface APIEnvelope {
  streams?: APICategory[];
}

// Backup source (timstreams.st's backend) has a different shape: categories
// hold `events`, each with plain `{name, url}` streams.
interface AltStream {
  name?: string;
  url?: string;
}
interface AltEvent {
  name?: string;
  logo?: string;
  time?: string;
  streams?: AltStream[];
}
interface AltCategory {
  category?: string;
  events?: AltEvent[];
}

// ppv.to was seized by law enforcement (July 2026); the service moved to ppv.st.
const PPV_API = 'https://api.ppv.st/api/streams';
// Backup for when ppv is down or missing a match (timstreams.st's backend).
const ALT_API = 'https://api.vixnuvew.uk/api/streams';

function parsePpv(data: APIEnvelope): Match[] {
  const cats: APICategory[] = data.streams ?? [];
  // 精确匹配 Football（避免 American/Australian Football）
  const football = cats.find((c) => (c.category || '').toLowerCase() === 'football');

  return (football?.streams || [])
    .map((s): Match | null => {
      const substreams = (s.substreams || [])
        .map(
          (sub): Substream => ({
            name: sub.name,
            source_tag: sub.source_tag,
            iframe: sub.iframe,
          }),
        )
        .filter((sub) => isTrustedStreamUrl(sub.iframe));
      const iframe = isTrustedStreamUrl(s.iframe) ? s.iframe : substreams[0]?.iframe;
      if (!iframe) return null;

      return {
        id: s.id,
        name: s.name,
        category_name: s.category_name || 'Football',
        iframe,
        viewers: s.viewers || '0',
        sourceTag: s.source_tag,
        poster: s.poster,
        colors: s.colors,
        tag: s.tag,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        alwaysLive: s.always_live === 1,
        substreams,
        slug: slugify(s.name),
      };
    })
    .filter((m): m is Match => m !== null);
}

// Alt event times are local America/New_York. The whole 2026 World Cup
// (Jun 11 – Jul 19) sits inside US daylight time, so a fixed EDT offset is
// exact. ponytail: hardcoded -04:00, add real tz math only if this outlives
// the tournament.
function altTimeToEpoch(time?: string): number | undefined {
  if (!time) return undefined;
  const ms = Date.parse(`${time}:00-04:00`);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

function parseAlt(data: AltCategory[]): Match[] {
  // Only "Events" (timed fixtures) — Replays and 24/7 channels can't map to a
  // WC match. Everything is labelled Football; the WC fixture matching in App
  // drops whatever isn't actually a World Cup game.
  return (Array.isArray(data) ? data : [])
    .filter((c) => (c.category || '').toLowerCase() === 'events')
    .flatMap((c) => c.events || [])
    .map((ev, i): Match | null => {
      const urls = (ev.streams || []).filter((s) => isTrustedStreamUrl(s.url));
      if (!ev.name || urls.length === 0) return null;
      const substreams: Substream[] = urls.slice(1).map((s) => ({
        name: s.name || 'HD',
        source_tag: s.name || 'HD',
        iframe: s.url as string,
      }));
      return {
        id: 1_000_000_000 + i, // synthetic — ppv ids stay well below this
        name: ev.name,
        category_name: 'Football',
        iframe: urls[0].url as string,
        viewers: '0',
        sourceTag: urls[0].name,
        poster: ev.logo,
        startsAt: altTimeToEpoch(ev.time),
        substreams,
        slug: slugify(ev.name),
      };
    })
    .filter((m): m is Match => m !== null);
}

export function useStreams() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<{ data: Match[]; ts: number } | null>(null);
  const initialRef = useRef(true);

  const fetchData = useCallback(async () => {
    // stale-while-revalidate: show cached data immediately on subsequent fetches
    if (cacheRef.current && !initialRef.current) {
      setMatches(cacheRef.current.data);
      setLoading(false);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    if (initialRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      // Both sources fingerprint-block datacenter requests, so they're fetched
      // directly from the browser (they allow CORS), never through the Worker.
      const load = async <T>(url: string, parse: (data: T) => Match[]): Promise<Match[]> => {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error('Failed to fetch streams');
        return parse((await res.json()) as T);
      };
      const [ppv, alt] = await Promise.allSettled([
        load(PPV_API, parsePpv),
        load(ALT_API, parseAlt),
      ]);
      if (signal.aborted) return;
      if (ppv.status === 'rejected' && alt.status === 'rejected') throw ppv.reason;

      // ppv first: downstream indexStreams dedupes by slug, first entry wins.
      const flat: Match[] = [
        ...(ppv.status === 'fulfilled' ? ppv.value : []),
        ...(alt.status === 'fulfilled' ? alt.value : []),
      ];
      cacheRef.current = { data: flat, ts: Date.now() };
      setMatches(flat);
      setError(null);
    } catch (err: unknown) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('Failed to fetch streams:', err);
      if (!cacheRef.current)
        setError(err instanceof Error ? err.message : 'Failed to fetch streams');
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        initialRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Poll every 60s when tab is visible, pause when hidden
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 60_000);
    return () => {
      abortRef.current?.abort();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchData]);

  return { matches, loading, error, refetch: fetchData };
}
