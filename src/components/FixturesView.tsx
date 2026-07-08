import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StandingsData } from '../adapters/types';
import { COMPETITIONS } from '../competitions';
import { useLeaders } from '../hooks/useLeaders';
import { useT } from '../i18n';
import type { CompMatch, Leader, Stage, TopScorer } from '../types';
import { navigate, pathFor, type Section, useRouter } from '../utils/router';
import BracketView from './BracketView';
import ConferenceStandings from './ConferenceStandings';
import LeadersView from './LeadersView';
import MatchCard from './MatchCard';
import StandingsView from './StandingsView';

const KNOWN_STAGES: Stage[] = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];

// World Cup keeps its scoreboard-sourced TopScorer[]; normalize it to the
// shared Leader[] shape at the render boundary (data path unchanged).
function scorersToLeaders(scorers: TopScorer[]): Leader[] {
  return scorers.map((s, i) => ({
    rank: i + 1,
    name: s.name,
    teamName: s.teamName,
    teamLogo: s.teamFlag,
    displayValue: String(s.goals),
    value: s.goals,
  }));
}

// Quick filter: which match statuses to show. Tournament-stage chips below
// further narrow by stage; this is a coarser "is the match still to play or
// already played?" toggle. Defaults to Upcoming so users land on what's next.
type StatusFilter = 'upcoming' | 'finished';

const NO_WATCHABLE: ReadonlySet<string> = new Set();

export default function FixturesView({
  section,
  matches,
  standings,
  scorers,
  watchableSlugs = NO_WATCHABLE,
  pipelineLeaders,
}: {
  section: Section;
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
  // Slugs of matches with a ppv.to stream live right now (resolved in App).
  watchableSlugs?: ReadonlySet<string>;
  // Optional pre-warmed pipeline leaders (from the SSR pass). When provided
  // and leadersSource === 'pipeline', used in place of useLeaders so the
  // first paint shows the SSR data with no fetch.
  pipelineLeaders?: Leader[];
}) {
  const t = useT();
  const { route } = useRouter();
  const comp = route.comp;
  const groups = standings.kind === 'soccer' ? standings.groups : [];
  const competition = COMPETITIONS[comp];
  const shape = competition?.shape ?? 'tournament';
  const leadersSource = competition?.leadersSource;
  // Hooks must run unconditionally. When pipelineLeaders is provided, the
  // hook is gated to a no-op (comp: null) so the island doesn't double-fetch.
  const pipeline = useLeaders(pipelineLeaders ? null : leadersSource === 'pipeline' ? comp : null, pipelineLeaders);
  const caps = competition?.capabilities;
  const effectiveSection: Section =
    (section === 'bracket' && caps && !caps.bracket) ||
    (section === 'scorers' && caps && !caps.scorers)
      ? 'matches'
      : section;
  // URL honesty: when a deep link hits a section this competition doesn't
  // have (e.g. /eng.1/bracket), the render falls back to matches above —
  // rewrite the URL to match so the Header highlight and shared links agree.
  useEffect(() => {
    if (effectiveSection !== section) {
      navigate(pathFor({ kind: 'section', comp, section: effectiveSection }), { replace: true });
    }
  }, [effectiveSection, section, comp]);
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('upcoming');
  const openMatch = useCallback(
    (m: CompMatch) => {
      navigate(pathFor({ kind: 'match', comp, slug: m.slug }));
    },
    [comp],
  );

  const stages: (Stage | 'all')[] = useMemo(() => {
    const present = new Set<Stage>(
      matches.map((m) => m.stage).filter((s): s is Stage => s !== undefined),
    );
    return ['all', ...KNOWN_STAGES.filter((s) => present.has(s))] as (Stage | 'all')[];
  }, [matches]);

  // Counts for the status-filter chips: shown regardless of the stage filter
  // so users see at a glance how many matches are finished vs still to play
  // (e.g. "Finished (48)"). The current `stage` selection does NOT affect
  // these totals — clicking a status chip first then a stage chip will
  // intersect, which is the expected behaviour.
  const counts = useMemo(() => {
    let upcoming = 0;
    let finished = 0;
    for (const m of matches) {
      if (m.status === 'finished') finished++;
      else upcoming++;
    }
    return { upcoming, finished };
  }, [matches]);

  // 按开球当天分组；组内按开球时间正序。未完赛(upcoming/live)在前(日期正序)，
  // 已完赛在后(日期倒序，最近的在上)，两段分开。
  const { upcoming, finished } = useMemo(() => {
    const filtered = stage === 'all' ? matches : matches.filter((m) => m.stage === stage);
    const group = (list: CompMatch[]) => {
      const map = new Map<string, CompMatch[]>();
      for (const m of list) {
        const k = m.kickoff;
        const key = k
          ? `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`
          : 'zzzz-tbd';
        (map.get(key) ?? map.set(key, []).get(key)!).push(m);
      }
      for (const arr of map.values()) {
        arr.sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0));
      }
      return [...map.entries()];
    };
    return {
      upcoming: group(filtered.filter((m) => m.status !== 'finished')).sort((a, _b) =>
        a[0].localeCompare(_b[0]),
      ),
      finished: group(filtered.filter((m) => m.status === 'finished')).sort((a, _b) =>
        _b[0].localeCompare(a[0]),
      ),
    };
  }, [matches, stage]);

  const renderDay = ([key, list]: [string, CompMatch[]]) => (
    <section key={key} className="space-y-stack">
      <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
        {list[0].kickoff
          ? list[0].kickoff.toLocaleDateString(undefined, {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : t('common.tbd')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack sm:gap-card">
        {list.map((m) => {
          const watchable = watchableSlugs.has(m.slug);
          return (
            <MatchCard
              key={m.id}
              homeName={m.homeName}
              awayName={m.awayName}
              homeFlag={m.homeFlag}
              awayFlag={m.awayFlag}
              homeScore={m.homeScore}
              awayScore={m.awayScore}
              status={m.status}
              kickoff={m.kickoff}
              stage={m.stage}
              group={m.group}
              statusText={m.statusText}
              progress={m.progress}
              finishType={m.finishType}
              homeShootoutScore={m.homeShootoutScore}
              awayShootoutScore={m.awayShootoutScore}
              winner={m.winner}
              watchable={watchable}
              homeScorers={m.homeScorers}
              awayScorers={m.awayScorers}
              venue={m.venue}
              // Clickable when not upcoming, or when watchable (a live stream
              // exists even if ESPN still shows the pre-match state).
              onOpen={m.status === 'upcoming' && !watchable ? undefined : () => openMatch(m)}
            />
          );
        })}
      </div>
    </section>
  );

  return (
    // Width + page padding come from the app shell (Layout.astro) now; this
    // just stacks its sections inside the shell's center column.
    <div className="space-y-section">
      <div className="space-y-section">
        {effectiveSection === 'scorers' ? (
          leadersSource === 'pipeline' ? (
            pipeline.loading && pipeline.leaders.length === 0 ? (
              <p className="font-mono text-xs tracking-[0.3em] text-pitch animate-pulse motion-reduce:animate-none">
                {t('common.loading')}
              </p>
            ) : pipeline.error && pipeline.leaders.length === 0 ? (
              <div className="flex flex-col items-start gap-3">
                <p className="font-mono text-xs tracking-wider text-chalkdim">{pipeline.error}</p>
                <button
                  type="button"
                  onClick={pipeline.refetch}
                  className="px-4 py-2 bg-pitch text-onaccent font-display font-semibold tracking-wide hover:brightness-110 transition"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <LeadersView
                leaders={pipeline.leaders}
                statLabelKey={
                  competition?.sport === 'basketball' ? 'leaders.points' : 'scorers.goals'
                }
                titleKey={competition?.sport === 'basketball' ? 'leaders.title' : 'scorers.title'}
                subtitleKey={
                  competition?.sport === 'basketball' ? 'leaders.subtitle' : 'scorers.subtitle'
                }
                empty={t('scorers.empty')}
              />
            )
          ) : (
            <LeadersView
              leaders={scorersToLeaders(scorers)}
              statLabelKey="scorers.goals"
              titleKey="scorers.title"
              subtitleKey="scorers.subtitle"
              empty={t('scorers.empty')}
            />
          )
        ) : effectiveSection === 'bracket' ? (
          <BracketView groups={groups} matches={matches} />
        ) : (
          <>
            {/* Quick filter: Upcoming / Finished. Counts are taken from the
              unfiltered match list so users always see how many matches exist
              in each bucket regardless of the stage selection below. */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {(
                [
                  {
                    key: 'upcoming',
                    label: t('fixtures.filterUpcoming'),
                    count: counts.upcoming,
                  },
                  {
                    key: 'finished',
                    label: t('fixtures.filterFinished'),
                    count: counts.finished,
                  },
                ] as { key: StatusFilter; label: string; count: number }[]
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  aria-pressed={statusFilter === key}
                  className={`ds-chip ${statusFilter === key ? 'ds-chip-active' : 'ds-chip-inactive'}`}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums text-chalkdim/70">{count}</span>
                </button>
              ))}
            </div>

            {shape !== 'season' && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {stages.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStage(s)}
                    aria-pressed={stage === s}
                    className={`ds-chip ${stage === s ? 'ds-chip-active' : 'ds-chip-inactive'}`}
                  >
                    {s === 'all' ? t('filter.all') : t(`stage.${s}`)}
                  </button>
                ))}
              </div>
            )}

            {/* Season-shape competitions (e.g. a domestic league) have a
                single always-visible table — there's no group stage to gate
                it behind. Tournament-shape competitions keep the existing
                behaviour: standings surface on top only while the group
                filter is active. Basketball comps render conference tables
                instead of the soccer group/league StandingsView. */}
            {standings.kind === 'basketball' ? (
              standings.conferences.length > 0 && (
                <section className="space-y-stack">
                  <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                    {t('fixtures.standings')}
                  </h3>
                  <ConferenceStandings conferences={standings.conferences} />
                </section>
              )
            ) : shape === 'season' && groups.length > 0 ? (
              <section className="space-y-stack">
                <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                  {t('fixtures.standings')}
                </h3>
                <StandingsView groups={groups} mode="league" />
              </section>
            ) : (
              stage === 'group' &&
              groups.length > 0 && (
                <section className="space-y-stack">
                  <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                    {t('fixtures.standings')}
                  </h3>
                  <StandingsView groups={groups} mode="group" />
                </section>
              )
            )}

            {(() => {
              const days = statusFilter === 'finished' ? finished : upcoming;
              if (days.length === 0) {
                // The status-filter counts above are unfiltered by stage, so a
                // status-specific message ("No finished matches yet") would
                // contradict a non-zero chip count when an empty stage is also
                // selected. Only assert that global truth when no stage narrows
                // the view; otherwise fall back to the neutral "no results".
                const emptyKey =
                  stage !== 'all'
                    ? 'common.empty'
                    : statusFilter === 'finished'
                      ? 'fixtures.finishedEmpty'
                      : 'fixtures.upcomingEmpty';
                return (
                  <p className="font-mono text-xs tracking-wider text-chalkdim">{t(emptyKey)}</p>
                );
              }
              return <>{days.map(renderDay)}</>;
            })()}
          </>
        )}
      </div>
    </div>
  );
}
