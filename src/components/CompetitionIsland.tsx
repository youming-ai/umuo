import { useMemo } from 'react';
import type { Leader } from '../types';
import type { StandingsData } from '../adapters/types';
import type { CompMatch, TopScorer } from '../types';
import { useCompetition } from '../hooks/useCompetition';
import { useStreams } from '../hooks/useStreams';
import { useT } from '../i18n';
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
//
// Pipeline leaders are owned by FixturesView (single useLeaders); this island
// only forwards the optional SSR seed so the first paint can show scorers
// without a client round-trip.
function CompetitionIslandInner({
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
  const t = useT();
  const { matches, standings, scorers, loading, error, refetch } = useCompetition(
    comp,
    initialData,
  );
  const streams = useStreams();

  // Cross-reference ESPN fixtures with ppv.st streams. Index once per
  // (matches, streams) change.
  const streamIndex = useMemo(() => indexStreams(streams.matches), [streams.matches]);
  const watchableSlugs = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const m of matches) {
      if (liveStreamForMatch(m, streamIndex, now)) set.add(m.slug);
    }
    return set;
  }, [matches, streamIndex]);

  // No usable data after a failed client fetch — surface retry instead of an
  // empty schedule that looks like "no matches this week".
  if (error && matches.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-mono text-xs tracking-wider text-chalkdim">{error}</p>
        <button
          type="button"
          onClick={refetch}
          className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide hover:brightness-110 transition"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (loading && matches.length === 0) {
    return (
      <p className="font-mono text-xs tracking-[0.3em] text-pitch animate-pulse motion-reduce:animate-none">
        {t('common.loading')}
      </p>
    );
  }

  return (
    <FixturesView
      section={section}
      matches={matches}
      standings={standings}
      scorers={scorers}
      watchableSlugs={watchableSlugs}
      // SSR seed only — FixturesView owns useLeaders for pipeline comps.
      pipelineLeaders={initialPipelineLeaders}
    />
  );
}

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
  return (
    <AppProviders>
      <CompetitionIslandInner
        comp={comp}
        section={section}
        initialData={initialData}
        initialPipelineLeaders={initialPipelineLeaders}
      />
    </AppProviders>
  );
}
