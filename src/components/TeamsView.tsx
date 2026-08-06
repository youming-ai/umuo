import type { TeamSummary } from '../types';
import { pathFor } from '../utils/router';

// Team directory grid. Every card links into the (now sport-general) team
// detail page.
export default function TeamsView({ comp, teams }: { comp: string; teams: TeamSummary[] }) {
  if (teams.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim">No teams available.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-card sm:grid-cols-3 lg:grid-cols-4">
      {teams.map((t) => (
        <a
          key={t.id}
          href={pathFor({ kind: 'team', comp, teamId: t.id })}
          className="ds-glass flex flex-col items-center gap-2 p-card ds-press hover:border-pitch/40"
        >
          {t.logo && <img src={t.logo} alt="" className="h-10 w-10 object-contain" />}
          <span className="w-full truncate text-center font-display text-sm text-chalk">
            {t.name}
          </span>
        </a>
      ))}
    </div>
  );
}
