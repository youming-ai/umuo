import { useT } from '../i18n';
import type { CompMatch, TopScorer, WCGroup, WCStanding } from '../types';
import { pathFor, useRouter } from '../utils/router';
import MatchCard from './MatchCard';

interface TeamPageProps {
  teamId: string;
  groups: WCGroup[];
  matches: CompMatch[];
  scorers: TopScorer[];
  /** Schedule URL for the up-navigation control (real `<a href>`). */
  backHref: string;
}

// Find the WCStanding row for the team by id, along with the parent
// group's name. The standings table is grouped per group letter, and
// we want to render that letter under the team name on the page.
function findStanding(
  groups: WCGroup[],
  teamId: string,
): { standing: WCStanding; group: string } | null {
  for (const g of groups) {
    const row = g.standings.find((s) => s.teamId === teamId);
    if (row) return { standing: row, group: g.name };
  }
  return null;
}

// All matches where the team is on either side, sorted by kickoff
// (upcoming first when there are scheduled matches, otherwise just date
// order). Finished matches group naturally by date.
function teamMatches(matches: CompMatch[], teamId: string): CompMatch[] {
  return matches
    .filter((m) => m.homeId === teamId || m.awayId === teamId)
    .sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0));
}

export default function TeamPage({ teamId, groups, matches, scorers, backHref }: TeamPageProps) {
  const t = useT();
  const { route } = useRouter();
  const comp = route.comp;
  const found = findStanding(groups, teamId);
  const standing = found?.standing ?? null;
  const groupLetter = found?.group ?? '';
  const teamName = standing?.name ?? '';
  const teamFlag = standing?.flag ?? '';
  const ownMatches = teamMatches(matches, teamId);
  const ownScorers = scorers.filter((s) => s.teamId === teamId);
  const backClass =
    'font-mono text-xs tracking-widest text-chalkdim hover:text-chalk transition-colors inline-flex items-center gap-1';

  if (!standing) {
    return (
      <div className="space-y-section w-full">
          <a href={backHref} className={backClass}>
            ← <span>{t('detail.back')}</span>
          </a>
          <p className="font-mono text-xs text-chalkdim p-card text-center">{t('team.notFound')}</p>
      </div>
    );
  }

  // Split matches into upcoming vs finished so the user sees the next
  // match first without scrolling through history.
  const upcoming = ownMatches.filter((m) => m.status !== 'finished');
  const finished = ownMatches.filter((m) => m.status === 'finished').reverse(); // newest first

  return (
    // Width + page padding come from the app shell; stack sections only.
    <div className="space-y-section">
        <a href={backHref} className={backClass}>
          ← <span>{t('detail.back')}</span>
        </a>

        {/* Header */}
        <div className="flex items-center gap-3">
          {teamFlag ? (
            <img src={teamFlag} alt={teamName} className="w-12 h-8 object-cover rounded-micro" />
          ) : (
            <span className="w-12 h-8 bg-overlay/5 rounded-micro" aria-hidden />
          )}
          <div>
            <h1 className="font-display font-bold text-2xl text-chalk tracking-wide">{teamName}</h1>
            {groupLetter && (
              <span className="ds-caption uppercase tracking-[0.18em] text-chalkdim">
                {t('common.group')} {groupLetter}
              </span>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-card ds-glass p-card">
          <Stat label={t('st.mp')} value={standing.mp} />
          <Stat label={t('st.w')} value={standing.w} tone="pitch" />
          <Stat label={t('st.d')} value={standing.d} />
          <Stat label={t('st.l')} value={standing.l} tone="live" />
          <Stat
            label={t('st.gd')}
            value={standing.gd > 0 ? `+${standing.gd}` : standing.gd}
            tone={standing.gd > 0 ? 'pitch' : standing.gd < 0 ? 'live' : undefined}
          />
          <Stat label={t('st.pts')} value={standing.pts} bold />
          {standing.form && (
            <div className="col-span-2 sm:col-span-5 flex items-center gap-2 pt-1">
              <span className="ds-caption uppercase tracking-wider text-chalkdim/60">
                {t('st.form')}:
              </span>
              <TeamFormPill form={standing.form} />
            </div>
          )}
        </div>

        {/* Matches */}
        <section className="space-y-3">
          <h2 className="font-display font-bold text-lg text-chalk tracking-wide">
            {t('team.matches')}
          </h2>
          {ownMatches.length === 0 ? (
            <p className="font-mono text-xs text-chalkdim">{t('team.matchesEmpty')}</p>
          ) : (
            <div className="space-y-3">
              {upcoming.length > 0 && <SubHeader>{t('team.upcoming')}</SubHeader>}
              {upcoming.map((m) => (
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
                  progress={m.progress}
                  href={pathFor({ kind: 'match', comp, slug: m.slug })}
                />
              ))}
              {finished.length > 0 && <SubHeader>{t('team.results')}</SubHeader>}
              {finished.map((m) => (
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
                  progress={m.progress}
                  finishType={m.finishType}
                  homeShootoutScore={m.homeShootoutScore}
                  awayShootoutScore={m.awayShootoutScore}
                  winner={m.winner}
                  href={pathFor({ kind: 'match', comp, slug: m.slug })}
                />
              ))}
            </div>
          )}
        </section>

        {/* Scorers from this team */}
        {ownScorers.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-chalk tracking-wide">
              {t('team.scorers')}
            </h2>
            <ul className="space-y-2 ds-glass p-card">
              {ownScorers.map((s) => (
                <li key={s.athleteId}>
                  <a
                    href={pathFor({ kind: 'player', comp, athleteId: s.athleteId })}
                    className="flex items-center justify-between font-mono text-xs hover:text-pitch transition-colors"
                  >
                    <span className="font-display text-sm text-chalk">{s.name}</span>
                    <span className="tabular-nums text-chalk">{s.goals}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string | number;
  tone?: 'pitch' | 'live';
  bold?: boolean;
}) {
  const valueClass = `font-mono tabular-nums ${bold ? 'text-xl font-bold' : 'text-base'} ${
    tone === 'pitch' ? 'text-pitch' : tone === 'live' ? 'text-live' : 'text-chalk'
  }`;
  return (
    <div className="flex flex-col items-center">
      <span className="ds-caption uppercase tracking-wider text-chalkdim/60">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return <h3 className="ds-caption uppercase tracking-[0.2em] text-chalkdim pt-2">{children}</h3>;
}

// Same colour-coded pill as the standings Form column. Inlined here
// rather than extracted to keep TeamPage self-contained; the duplication
// is small (~15 lines) and the visual contract is fixed.
function TeamFormPill({ form }: { form: string }) {
  return (
    <span role="img" aria-label={`Last 5 matches: ${form}`} className="inline-flex gap-0.5">
      {form.split('').map((c, _i, arr) => {
        const key = `${c}-${arr.length - 1 - _i}`;
        const label = c === 'W' ? 'win' : c === 'D' ? 'draw' : 'loss';
        return (
          <span
            key={key}
            title={label}
            className={`inline-block w-3.5 h-3.5 ds-micro font-bold leading-[14px] text-center rounded-micro ${
              c === 'W'
                ? 'bg-pitch text-onaccent'
                : c === 'D'
                  ? 'bg-chalkdim/30 text-chalk'
                  : 'bg-live/20 text-live'
            }`}
            aria-hidden
          >
            {c}
          </span>
        );
      })}
    </span>
  );
}
