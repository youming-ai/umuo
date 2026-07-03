import { useT } from '../i18n';
import type { CompMatch, ScorerEntry, TopScorer, WCGroup } from '../types';
import { navigate, pathFor, useRouter } from '../utils/router';
import { scorerDisplay } from '../utils/wc';

interface PlayerPageProps {
  athleteId: string;
  groups: WCGroup[];
  matches: CompMatch[];
  scorers: TopScorer[];
  onBack: () => void;
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
function teamNameFor(groups: WCGroup[], teamId: string | undefined): string {
  if (!teamId) return '';
  for (const g of groups) {
    for (const s of g.standings) {
      if (s.teamId === teamId) return s.name;
    }
  }
  return '';
}

export default function PlayerPage({
  athleteId,
  groups,
  matches,
  scorers,
  onBack,
}: PlayerPageProps) {
  const t = useT();
  const { route } = useRouter();
  const comp = route.comp;
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

  if (!topScorerEntry && goals.length === 0) {
    return (
      <div className="ds-page">
        <div className="ds-page-inner w-full">
          <button
            type="button"
            onClick={onBack}
            className="font-mono text-xs tracking-widest text-chalkdim hover:text-chalk transition-colors inline-flex items-center gap-1"
          >
            ← <span>{t('detail.back')}</span>
          </button>
          <p className="font-mono text-xs text-chalkdim p-card text-center">
            {t('player.notFound')}
          </p>
        </div>
      </div>
    );
  }

  return (
    // px OUTSIDE, max-w-6xl INSIDE — matches the schedule/header frame exactly.
    <div className="ds-page">
      <div className="ds-page-inner">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-xs tracking-widest text-chalkdim hover:text-chalk transition-colors inline-flex items-center gap-1"
        >
          ← <span>{t('detail.back')}</span>
        </button>

        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-3xl text-chalk tracking-wide">
            {topScorerEntry?.name ?? goals[0]?.entry.name ?? ''}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            {teamId && (
              <button
                type="button"
                onClick={() => navigate(pathFor({ kind: 'team', comp, teamId }))}
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-chalkdim hover:text-pitch transition-colors"
              >
                {teamName}
              </button>
            )}
            {topScorerEntry && (
              <span className="font-mono text-[11px] text-chalkdim/60">
                {topScorerEntry.goals} {t('player.goals')}
              </span>
            )}
          </div>
        </div>

        {/* Stats strip */}
        {topScorerEntry && (
          <div className="grid grid-cols-2 gap-2 sm:gap-card ds-glass p-card max-w-xs">
            <Stat label={t('scorers.goals')} value={topScorerEntry.goals} bold />
          </div>
        )}

        {/* Goals timeline */}
        <section className="space-y-3">
          <h2 className="font-display font-bold text-lg text-chalk tracking-wide">
            {t('player.goals')}
          </h2>
          {goals.length === 0 ? (
            <p className="font-mono text-xs text-chalkdim">{t('player.noGoals')}</p>
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
                      <span className="text-chalk tabular-nums w-12 shrink-0">
                        {g.entry.minute}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(pathFor({ kind: 'match', comp, slug: g.match.slug }))
                        }
                        className="font-display text-sm text-chalk hover:text-pitch transition-colors truncate text-left"
                      >
                        {g.match.homeName} vs {g.match.awayName}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-chalk tabular-nums">{score}</span>
                      <span className="text-chalkdim/60 truncate hidden sm:inline">{opp}</span>
                      {g.entry.tag && (
                        <span className="text-chalkdim/60 ds-caption uppercase">
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
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string | number; bold?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="ds-caption uppercase tracking-wider text-chalkdim/60">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? 'text-3xl font-bold text-pitch' : 'text-base text-chalk'}`}
      >
        {value}
      </span>
    </div>
  );
}

// scorerDisplay is re-exported for tests that want to verify the
// expected display string for a given ScorerEntry.
void scorerDisplay;
