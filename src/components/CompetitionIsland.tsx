import { useMemo } from 'react';
import type { Leader } from '../types';
import type { StandingsData } from '../adapters/types';
import type { CompMatch, TopScorer } from '../types';
import { useCompetition } from '../hooks/useCompetition';
import { useLeaders } from '../hooks/useLeaders';
import { useStreams } from '../hooks/useStreams';
import FixturesView from './FixturesView';
import AppProviders from './AppProviders';
import type { Section } from '../utils/router';
import { indexStreams, liveStreamForMatch } from '../utils/streamMatch';

interface CompetitionInitialData {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
}

// The whole competition view (matches / scorers / bracket) as one client-only
// island. Wired to the SSR-fetched seed data from getCompetitionView +
// getPipelineLeaders, so the island skips its first fetch and starts polling
// right where the server left off. Streams come from useStreams (browser-only
// — ppv.st fingerprint-blocks datacenter IPs, so SSR can't pre-compute
// watchableSlugs; the island computes them after mount).
export default function CompetitionIsland({
  comp,
  section,
  initialData,
  initialPipelineLeaders,
}: {
  comp: string;
  section: Section;
  initialData: CompetitionInitialData;
  initialPipelineLeaders?: Leader[];
}) {
  const { matches, standings, scorers } = useCompetition(comp, initialData);
  const { leaders } = useLeaders(initialPipelineLeaders ? comp : null, initialPipelineLeaders);
  const streams = useStreams();

  // Cross-reference ESPN fixtures with ppv.st streams (same logic as
  // App.tsx). Index once per (matches, streams) change.
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
      <FixturesView
        section={section}
        matches={matches}
        standings={standings}
        scorers={scorers}
        watchableSlugs={watchableSlugs}
        // Pass pipeline leaders so FixturesView skips its internal useLeaders fetch.
        pipelineLeaders={leaders}
      />
    </AppProviders>
  );
}
