import { useMemo, useState } from 'react';
import type { StandingsData } from '../adapters/types';
import { COMPETITIONS } from '../competitions';
import type { CompMatch, Stage } from '../types';
import { pathFor, type Section, useRouter } from '../utils/router';
import { stageLabel } from '../utils/wc';
import BracketView from './BracketView';
import ConferenceStandings from './ConferenceStandings';
import MatchCard from './MatchCard';
import StandingsView from './StandingsView';

const KNOWN_STAGES: Stage[] = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];

// Quick filter: which match statuses to show. Tournament-stage chips below
// further narrow by stage; this is a coarser "is the match still to play or
// already played?" toggle. Defaults to Upcoming so users land on what's next.
type StatusFilter = 'upcoming' | 'finished';

export default function FixturesView({
  section,
  matches,
  standings,
}: {
  section: Section;
  matches: CompMatch[];
  standings: StandingsData;
}) {
  const { route } = useRouter();
  const comp = route.comp;
  const groups = standings.kind === 'soccer' ? standings.groups : [];
  const competition = COMPETITIONS[comp];
  const shape = competition?.shape ?? 'tournament';
  const caps = competition?.capabilities;
  // Unsupported capability deep-links (e.g. /eng.1/bracket) are redirected
  // server-side in the Astro pages. Keep a render-time fallback so a stale
  // client navigation still shows matches instead of an empty section.
  const effectiveSection: Section =
    section === 'bracket' && caps && !caps.bracket ? 'matches' : section;
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('upcoming');

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
          : 'TBD'}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack sm:gap-card">
        {list.map((m) => (
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
            homeScorers={m.homeScorers}
            awayScorers={m.awayScorers}
            venue={m.venue}
            href={
              m.status === 'upcoming' ? undefined : pathFor({ kind: 'match', comp, slug: m.slug })
            }
          />
        ))}
      </div>
    </section>
  );

  return (
    // Width + page padding come from the app shell (Layout.astro) now; this
    // just stacks its sections inside the shell's center column.
    <div className="space-y-section">
      {effectiveSection === 'bracket' ? (
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
                  label: 'Upcoming',
                  count: counts.upcoming,
                },
                {
                  key: 'finished',
                  label: 'Finished',
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
                <span className="ml-1.5 tabular-nums text-chalkdim">{count}</span>
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
                  {s === 'all' ? 'All' : stageLabel(s)}
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
                  Standings
                </h3>
                <ConferenceStandings conferences={standings.conferences} />
              </section>
            )
          ) : shape === 'season' && groups.length > 0 ? (
            <section className="space-y-stack">
              <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                Standings
              </h3>
              <StandingsView groups={groups} mode="league" />
            </section>
          ) : (
            stage === 'group' &&
            groups.length > 0 && (
              <section className="space-y-stack">
                <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                  Standings
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
              const emptyMessage =
                stage !== 'all'
                  ? 'No results found'
                  : statusFilter === 'finished'
                    ? 'No finished matches yet'
                    : 'No upcoming matches';
              return (
                <p className="font-mono text-xs tracking-wider text-chalkdim">{emptyMessage}</p>
              );
            }
            return <>{days.map(renderDay)}</>;
          })()}
        </>
      )}
    </div>
  );
}
