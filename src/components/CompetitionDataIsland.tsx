import type { ReactNode } from 'react';
import type { StandingsData } from '../adapters/types';
import { useCompetition } from '../hooks/useCompetition';
import type { CompMatch } from '../types';

export interface CompetitionInitialData {
  matches: CompMatch[];
  standings: StandingsData;
}

interface CompetitionView {
  matches: CompMatch[];
  standings: StandingsData;
}

// Shared competition-data island: owns the useCompetition SWR loop plus the
// loading / error+retry states, and hands the resolved view to a render-prop
// child. CompetitionIsland (fixtures) and OddsIsland (odds) differ only in that
// leaf, so both delegate here instead of copying the wrapper. Not mounted by
// Astro directly — Astro can't pass a function child — the thin islands are the
// client:only entry points.
export default function CompetitionDataIsland({
  comp,
  initialData,
  children,
}: {
  comp: string;
  initialData: CompetitionInitialData;
  children: (view: CompetitionView) => ReactNode;
}) {
  const { matches, standings, loading, error, refetch } = useCompetition(comp, initialData);

  if (error && matches.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-mono text-xs tracking-wider text-chalkdim">{error}</p>
        <button
          type="button"
          onClick={refetch}
          className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide hover:brightness-110 ds-press"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading && matches.length === 0) {
    return (
      <p className="font-mono text-xs tracking-caption text-pitch animate-pulse motion-reduce:animate-none">
        Loading…
      </p>
    );
  }

  return <>{children({ matches, standings })}</>;
}
