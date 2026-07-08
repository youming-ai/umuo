import { useMemo } from 'react';
import { useCallback } from 'react';
import type { CompMatch, Match } from '../types';
import type { MatchDetail } from '../adapters/types';
import { useRouter, navigate, pathFor } from '../utils/router';
import { useStreams } from '../hooks/useStreams';
import { indexStreams, liveStreamForMatch } from '../utils/streamMatch';
import MatchDetailPage from './MatchDetailPage';
import AppProviders from './AppProviders';

// The match-detail island. Wraps <MatchDetailPage> with the SSR-seeded data
// and computes the stream / back action on the client (where useRouter +
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

  const backHome = useCallback(
    () =>
      navigate(pathFor({ kind: 'section', comp: route.comp, section: 'matches' }), {
        replace: true,
      }),
    [route.comp],
  );

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
        onBack={backHome}
        initialDetail={initialDetail}
      />
    </AppProviders>
  );
}
