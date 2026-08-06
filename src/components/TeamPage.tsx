import type { TeamDetail } from '../types';

// Sport-general team page rendered from ESPN's site.api team detail
// (header + injuries + schedule + roster). Works for soccer and basketball.
export default function TeamPage({ team, backHref }: { team: TeamDetail; backHref: string }) {
  return (
    <div className="space-y-section">
      <a href={backHref} className="ds-caption text-chalkdim transition-colors hover:text-chalk">
        ← Teams
      </a>

      <header className="ds-glass-hero flex items-center gap-4 p-card">
        {team.logo && <img src={team.logo} alt="" className="h-14 w-14 object-contain" />}
        <div>
          <h1 className="font-display text-hero font-bold tracking-wide text-chalk">{team.name}</h1>
          {(team.record || team.standingSummary) && (
            <p className="ds-caption text-chalkdim">
              {[team.record, team.standingSummary].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </header>

      {team.injuries.length > 0 && (
        <section className="space-y-card">
          <h2 className="font-display text-lg font-bold text-chalk">Injuries</h2>
          <ul className="ds-glass divide-y divide-overlay/5">
            {team.injuries.map((inj) => (
              <li key={inj.name} className="flex items-start justify-between gap-3 p-3">
                <span className="font-display text-sm text-chalk">{inj.name}</span>
                <span className="ds-caption shrink-0 text-live">{inj.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-card">
        <h2 className="font-display text-lg font-bold text-chalk">Schedule</h2>
        {team.schedule.length === 0 ? (
          <p className="font-mono text-xs text-chalkdim">No scheduled games.</p>
        ) : (
          <ul className="ds-glass divide-y divide-overlay/5">
            {team.schedule.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 p-3">
                <span className="truncate font-display text-sm text-chalk">{g.name}</span>
                <span className="ds-caption shrink-0 tabular-nums text-chalkdim">{g.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-card">
        <h2 className="font-display text-lg font-bold text-chalk">Roster</h2>
        {team.roster.length === 0 ? (
          <p className="font-mono text-xs text-chalkdim">No roster available.</p>
        ) : (
          <table className="ds-glass w-full overflow-hidden text-sm">
            <thead className="ds-caption uppercase text-chalkdim">
              <tr className="border-b border-overlay/5">
                <th scope="col" className="w-10 px-3 py-2 text-left">
                  #
                </th>
                <th scope="col" className="px-3 py-2 text-left">
                  Player
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Pos
                </th>
              </tr>
            </thead>
            <tbody>
              {team.roster.map((p) => (
                <tr key={p.id} className="border-b border-overlay/5 last:border-b-0">
                  <td className="px-3 py-2 font-mono tabular-nums text-chalkdim">{p.jersey}</td>
                  <td className="px-3 py-2 font-display text-chalk">{p.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-chalkdim">{p.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
