import type { CompMatch, Group, ScorerEntry, TopScorer } from '../types';
import { pathFor } from '../utils/router';

interface PlayerPageProps {
  comp: string;
  athleteId: string;
  groups: Group[];
  matches: CompMatch[];
  scorers: TopScorer[];
  /** Schedule URL for the up-navigation control (real `<a href>`). */
  backHref: string;
}

// One goal scored by the player in a specific match, with the full match
// context. We build this by walking all matches and collecting entries
// whose playerId matches.
interface PlayerGoal {
  match: CompMatch;
  entry: ScorerEntry;
  side: 'home' | 'away';
}

// All matches where this player scored, sorted by match kickoff (oldest
// first). Returns goals + the match alongside so the page can render
// "Match X — Y — goal 67'" entries.
function playerGoals(matches: CompMatch[], athleteId: string): PlayerGoal[] {
  const goals: PlayerGoal[] = [];
  for (const m of matches) {
    for (const entry of m.homeScorers) {
      if (entry.playerId === athleteId) {
        goals.push({ match: m, entry, side: 'home' });
      }
    }
    for (const entry of m.awayScorers) {
      if (entry.playerId === athleteId) {
        goals.push({ match: m, entry, side: 'away' });
      }
    }
  }
  goals.sort((a, b) => (a.match.kickoff?.getTime() ?? 0) - (b.match.kickoff?.getTime() ?? 0));
  return goals;
}

// Team display name (resolved from the standings feed's group entries).
function teamNameFor(groups: Group[], teamId: string | undefined): string {
  if (!teamId) return '';
  for (const g of groups) {
    for (const s of g.standings) {
      if (s.teamId === teamId) return s.name;
    }
  }
  return '';
}

export default function PlayerPage({
  comp,
  athleteId,
  groups,
  matches,
  scorers,
  backHref,
}: PlayerPageProps) {
  const topScorerEntry = scorers.find((s) => s.athleteId === athleteId);
  const goals = playerGoals(matches, athleteId);
  // Fallback team (player not in the top-scorers feed): use the side they
  // scored on, not always home — otherwise away scorers get attributed to the
  // opponent.
  const firstGoal = goals[0];
  const fallbackTeamId = firstGoal
    ? firstGoal.side === 'home'
      ? firstGoal.match.homeId
      : firstGoal.match.awayId
    : undefined;
  const teamId = topScorerEntry?.teamId ?? fallbackTeamId;
  const teamName = topScorerEntry?.teamName || teamNameFor(groups, teamId);
  const backClass =
    'font-mono text-xs tracking-widest text-chalkdim hover:text-chalk transition-colors inline-flex items-center gap-1';

  if (!topScorerEntry && goals.length === 0) {
    return (
      <div className="space-y-section w-full">
        <a href={backHref} className={backClass}>
          ← <span>Back</span>
        </a>
        <p className="font-mono text-xs text-chalkdim p-card text-center">Player not found</p>
      </div>
    );
  }

  return (
    // Width + page padding come from the app shell; stack sections only.
    <div className="space-y-section">
      <a href={backHref} className={backClass}>
        ← <span>Back</span>
      </a>

      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-hero text-chalk tracking-wide">
          {topScorerEntry?.name ?? goals[0]?.entry.name ?? ''}
        </h1>
        <div className="flex items-center gap-3 mt-1">
          {teamId && (
            <a
              href={pathFor({ kind: 'team', comp, teamId })}
              className="font-mono text-label uppercase tracking-caption text-chalkdim hover:text-pitch transition-colors"
            >
              {teamName}
            </a>
          )}
          {topScorerEntry && (
            <span className="font-mono text-label text-chalkdim">{topScorerEntry.goals} goals</span>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {topScorerEntry && (
        <div className="grid grid-cols-2 gap-2 sm:gap-card ds-glass p-card max-w-xs">
          <Stat label="G" value={topScorerEntry.goals} bold />
        </div>
      )}

      {/* Goals timeline */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-lg text-chalk tracking-wide">Goals</h2>
        {goals.length === 0 ? (
          <p className="font-mono text-xs text-chalkdim">No goals scored yet</p>
        ) : (
          <ul className="space-y-2 ds-glass p-card">
            {goals.map((g) => {
              const opp = g.side === 'home' ? g.match.awayName : g.match.homeName;
              const score = `${g.match.homeScore ?? 0} : ${g.match.awayScore ?? 0}`;
              return (
                <li
                  key={`${g.match.id}-${g.entry.minute}`}
                  className="flex items-center justify-between font-mono text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-chalk tabular-nums w-12 shrink-0">{g.entry.minute}</span>
                    <a
                      href={pathFor({ kind: 'match', comp, slug: g.match.slug })}
                      className="font-display text-sm text-chalk hover:text-pitch transition-colors truncate text-left"
                    >
                      {g.match.homeName} vs {g.match.awayName}
                    </a>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-chalk tabular-nums">{score}</span>
                    <span className="text-chalkdim truncate hidden sm:inline">{opp}</span>
                    {g.entry.tag && (
                      <span className="text-chalkdim ds-caption uppercase">
                        {g.entry.tag.trim()}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string | number; bold?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="ds-caption uppercase tracking-wider text-chalkdim">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? 'text-3xl font-bold text-pitch' : 'text-base text-chalk'}`}
      >
        {value}
      </span>
    </div>
  );
}
