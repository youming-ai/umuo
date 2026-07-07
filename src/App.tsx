import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo } from 'react';
import Footer from './components/Footer';
import Header from './components/Header';
import MatchDetailPage from './components/MatchDetailPage';
import NewsView from './components/NewsView';
import PlayerPage from './components/PlayerPage';
import TeamPage from './components/TeamPage';
import { useCompetition } from './hooks/useCompetition';
import { useStreams } from './hooks/useStreams';
import { translate, useLang, useT } from './i18n';
import { canonicalPath, navigate, pathFor, useRouter } from './utils/router';
import { indexStreams, liveStreamForMatch } from './utils/streamMatch';

const FixturesView = lazy(() => import('./components/FixturesView'));

function Loading() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center h-full bg-night gap-4">
      <span className="font-mono text-xs tracking-[0.3em] text-pitch animate-pulse motion-reduce:animate-none">
        {t('common.loading')}
      </span>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center h-full bg-night p-card text-center gap-3">
      <div className="font-mono text-xs tracking-[0.3em] text-live">{t('common.signalLost')}</div>
      <h2 className="font-display font-bold text-2xl text-chalk tracking-wide">
        {t('common.error')}
      </h2>
      <p className="font-body text-sm text-chalkdim max-w-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide hover:brightness-110 transition"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}

function NotFound({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center h-full bg-night gap-3 p-card text-center">
      <div className="font-mono text-xs tracking-[0.3em] text-chalkdim">404</div>
      <h2 className="font-display font-bold text-2xl text-chalk tracking-wide">
        {t('common.error')}
      </h2>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide hover:brightness-110 transition"
      >
        {t('detail.back')}
      </button>
    </div>
  );
}

export default function App() {
  const { lang } = useLang();
  const streams = useStreams();
  const { route } = useRouter();
  const wc = useCompetition(route.comp);
  const groups = wc.standings.kind === 'soccer' ? wc.standings.groups : [];

  useEffect(() => {
    document.title = `StreamCup — ${translate(lang, 'brand.subtitle')}`;
  }, [lang]);

  const backHome = useCallback(
    () =>
      navigate(pathFor({ kind: 'section', comp: route.comp, section: 'matches' }), {
        replace: true,
      }),
    [route.comp],
  );

  // Legacy (pre-multi-comp) links like /scorers or /match/<slug> still resolve
  // (parseRoute maps them under the default competition); rewrite the URL to
  // its canonical /<comp>/... form so shared deep links stay consistent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route change is the re-check trigger
  useEffect(() => {
    const c = canonicalPath(window.location.pathname);
    if (c) navigate(c, { replace: true });
  }, [route]);

  // Cross-reference ESPN fixtures with ppv.to streams (different sources, no
  // shared id — matched by canonical team-name slug). Index the streams once,
  // then the slugs of matches whose stream is live now drive the "watch" badge.
  const streamIndex = useMemo(() => indexStreams(streams.matches), [streams.matches]);
  const watchableSlugs = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const m of wc.matches) {
      if (liveStreamForMatch(m, streamIndex, now)) set.add(m.slug);
    }
    return set;
  }, [wc.matches, streamIndex]);

  // Build the content for the current route. WC-data pages wait for the
  // schedule fetch (and surface its error) before deciding anything is
  // missing, so a cold-loaded shared link never flashes 404.
  let content: ReactNode;
  if (route.kind === 'news') {
    content = <NewsView scope={route.scope} />;
  } else if (route.kind === 'section') {
    content = wc.loading ? (
      <Loading />
    ) : wc.error ? (
      <ErrorState message={wc.error} onRetry={wc.refetch} />
    ) : (
      <Suspense fallback={<Loading />}>
        <FixturesView
          section={route.section}
          matches={wc.matches}
          standings={wc.standings}
          scorers={wc.scorers}
          watchableSlugs={watchableSlugs}
        />
      </Suspense>
    );
  } else if (route.kind === 'match') {
    if (wc.loading) {
      content = <Loading />;
    } else if (wc.error) {
      content = <ErrorState message={wc.error} onRetry={wc.refetch} />;
    } else {
      const match = wc.matches.find((m) => m.slug === route.slug);
      content = match ? (
        <MatchDetailPage
          match={match}
          stream={liveStreamForMatch(match, streamIndex, Date.now())}
          onBack={backHome}
        />
      ) : (
        <NotFound onBack={backHome} />
      );
    }
  } else if (route.kind === 'team') {
    content = wc.loading ? (
      <Loading />
    ) : wc.error ? (
      <ErrorState message={wc.error} onRetry={wc.refetch} />
    ) : (
      <TeamPage
        teamId={route.teamId}
        groups={groups}
        matches={wc.matches}
        scorers={wc.scorers}
        onBack={backHome}
      />
    );
  } else {
    content = wc.loading ? (
      <Loading />
    ) : wc.error ? (
      <ErrorState message={wc.error} onRetry={wc.refetch} />
    ) : (
      <PlayerPage
        athleteId={route.athleteId}
        groups={groups}
        matches={wc.matches}
        scorers={wc.scorers}
        onBack={backHome}
      />
    );
  }

  return (
    // Single scroll container for the whole app, so the sticky Header shares the
    // SAME scrollbar gutter as the content below — they line up on desktop
    // (classic scrollbar) and mobile (overlay) with no per-platform padding hack.
    <div className="flex flex-col h-dvh overflow-y-auto [scrollbar-gutter:stable_both-edges] bg-night">
      <Header section={route.kind === 'section' ? route.section : undefined} />
      <div className="flex-1 flex flex-col">{content}</div>
      {(route.kind === 'section' || route.kind === 'news') && <Footer />}
    </div>
  );
}
