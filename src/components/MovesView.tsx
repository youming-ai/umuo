import type { LeagueInjuryGroup, TransactionItem } from '../types';
import LocalTime from './LocalTime';

// NBA "Roster Moves": recent transactions + current league injuries (grouped
// by team). Both feeds are NBA-rich year-round; the page is capability-gated so
// it only renders for competitions that populate them.
export default function MovesView({
  transactions,
  injuries,
}: {
  transactions: TransactionItem[];
  injuries: LeagueInjuryGroup[];
}) {
  if (transactions.length === 0 && injuries.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim">No recent moves.</p>;
  }
  return (
    <div className="space-y-section">
      {transactions.length > 0 && (
        <section className="space-y-card">
          <h2 className="font-display text-lg font-bold text-chalk">Transactions</h2>
          <ul className="ds-glass divide-y divide-overlay/5 rounded-card">
            {transactions.map((t) => {
              const d = new Date(t.date);
              const valid = !Number.isNaN(d.getTime());
              return (
                <li key={`${t.date}-${t.description}`} className="flex items-start gap-3 p-3">
                  <span className="ds-caption w-12 shrink-0 tabular-nums text-chalkdim">
                    {valid && (
                      <LocalTime
                        date={d}
                        locale="en-US"
                        options={{ month: 'short', day: 'numeric' }}
                      />
                    )}
                  </span>
                  <span className="text-sm text-chalk">
                    {t.team && <span className="font-display">{t.team}: </span>}
                    {t.description}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {injuries.length > 0 && (
        <section className="space-y-card">
          <h2 className="font-display text-lg font-bold text-chalk">Injuries</h2>
          <div className="grid gap-card sm:grid-cols-2">
            {injuries.map((g) => (
              <div key={g.team} className="ds-glass rounded-card p-card">
                <h3 className="ds-caption mb-2 uppercase tracking-[0.15em] text-chalkdim">
                  {g.team}
                </h3>
                <ul className="space-y-1">
                  {g.players.map((p) => (
                    <li key={p.name} className="flex justify-between gap-2 text-sm">
                      <span className="truncate text-chalk">{p.name}</span>
                      <span className="ds-caption shrink-0 text-live">{p.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
