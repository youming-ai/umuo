import { useMemo, useState } from 'react';
import type { StandingsData } from '../adapters/types';
import type { CompMatch } from '../types';
import { pathFor, useRouter } from '../utils/router';
import ConferenceStandings from './ConferenceStandings';
import MatchCard from './MatchCard';
import StandingsView from './StandingsView';

// Quick filter: which match statuses to show. Defaults to Upcoming so users
// land on what's next.
type StatusFilter = 'upcoming' | 'finished';

export default function FixturesView({
  matches,
  standings,
}: {
  matches: CompMatch[];
  standings: StandingsData;
}) {
  const { route } = useRouter();
  const comp = route.comp;
  const groups = standings.kind === 'soccer' ? standings.groups : [];
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('upcoming');

  // Counts for the status-filter chips (e.g. "Finished (48)").
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
      upcoming: group(matches.filter((m) => m.status !== 'finished')).sort((a, _b) =>
        a[0].localeCompare(_b[0]),
      ),
      finished: group(matches.filter((m) => m.status === 'finished')).sort((a, _b) =>
        _b[0].localeCompare(a[0]),
      ),
    };
  }, [matches]);

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
            eventKey={`${m.status}-${m.homeScore ?? 0}-${m.awayScore ?? 0}`}
            homeName={m.homeName}
            awayName={m.awayName}
            homeFlag={m.homeFlag}
            awayFlag={m.awayFlag}
            homeScore={m.homeScore}
            awayScore={m.awayScore}
            status={m.status}
            kickoff={m.kickoff}
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
      {/* Quick filter: Upcoming / Finished. */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {(
          [
            { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { key: 'finished', label: 'Finished', count: counts.finished },
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

      {/* Standings: basketball comps render conference tables; soccer comps
              render the single always-visible league table. */}
      {standings.kind === 'basketball'
        ? standings.conferences.length > 0 && (
            <section className="space-y-stack">
              <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                Standings
              </h3>
              <ConferenceStandings conferences={standings.conferences} />
            </section>
          )
        : groups.length > 0 && (
            <section className="space-y-stack">
              <h3 className="font-mono text-xs tracking-[0.2em] text-chalkdim uppercase">
                Standings
              </h3>
              <StandingsView groups={groups} mode="league" />
            </section>
          )}

      {(() => {
        const days = statusFilter === 'finished' ? finished : upcoming;
        if (days.length === 0) {
          const emptyMessage =
            statusFilter === 'finished' ? 'No finished matches yet' : 'No upcoming matches';
          return <p className="font-mono text-xs tracking-wider text-chalkdim">{emptyMessage}</p>;
        }
        return <>{days.map(renderDay)}</>;
      })()}
    </div>
  );
}
