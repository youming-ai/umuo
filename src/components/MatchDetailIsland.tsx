import { useMemo } from 'react';
import type { CompMatch, Match } from '../types';
import type { MatchDetail } from '../adapters/types';
import { useRouter, pathFor } from '../utils/router';
import { useStreams } from '../hooks/useStreams';
import { indexStreams, liveStreamForMatch } from '../utils/streamMatch';
import MatchDetailPage from './MatchDetailPage';
import AppProviders from './AppProviders';

// The match-detail island. Wraps <MatchDetailPage> with the SSR-seeded data
// and computes the stream / back link on the client (where useRouter +
// useStreams can run). Mounted by [comp]/match/[slug].astro as client:only.
export default function MatchDetailIsland({
  match,
  initialDetail,
}: {
  match: CompMatch;
  initialDetail: MatchDetail | null;
}) {
  const { route } = useRouter();
  const streams = useStreams();
  const backHref = pathFor({ kind: 'section', comp: route.comp, section: 'matches' });

  // Resolve the stream (browser-only — ppv.st blocks datacenter IPs).
  const streamIndex = useMemo(() => indexStreams(streams.matches), [streams.matches]);
  const stream: Match | null = useMemo(() => {
    const s = liveStreamForMatch(match, streamIndex, Date.now());
    return s ?? null;
  }, [match, streamIndex]);

  return (
    <AppProviders>
      <MatchDetailPage
        match={match}
        stream={stream}
        backHref={backHref}
        initialDetail={initialDetail}
      />
    </AppProviders>
  );
}
