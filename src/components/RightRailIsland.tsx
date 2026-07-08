import { useMemo } from 'react';
import type { CompMatch, TopScorer } from '../types';
import type { StandingsData } from '../adapters/types';
import { useCompetition } from '../hooks/useCompetition';
import { useStreams } from '../hooks/useStreams';
import { indexStreams, liveStreamForMatch } from '../utils/streamMatch';
import AppProviders from './AppProviders';
import RightRail from './RightRail';

interface InitialData {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

// Right-rail as a self-contained island. On comp pages it seeds from the same
// SSR initialData the center island already got; on other pages (team/player)
// initialData is omitted and it self-fetches on mount (SWR, worker KV-cached),
// so those pages need no extra SSR fetch — just a brief rail flash.
// ponytail: this runs a 2nd useCompetition poll alongside the center island —
// the worker coalesces + KV-caches, so upstream ESPN load is unchanged. Hoist
// to a shared context only if the extra worker hits ever matter.
export default function RightRailIsland({
  comp,
  initialData,
}: {
  comp: string;
  initialData?: InitialData;
}) {
  const { matches, standings, scorers } = useCompetition(comp, initialData);
  const streams = useStreams();
  const streamIndex = useMemo(() => indexStreams(streams.matches), [streams.matches]);
  const watchableSlugs = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const m of matches) {
      if (liveStreamForMatch(m, streamIndex, now)) set.add(m.slug);
    }
    return set;
  }, [matches, streamIndex]);

  return (
    <AppProviders>
      <RightRail
        matches={matches}
        standings={standings}
        scorers={scorers}
        streamIndex={streamIndex}
        watchableSlugs={watchableSlugs}
      />
    </AppProviders>
  );
}
