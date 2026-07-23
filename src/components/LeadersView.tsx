import type { Leader } from '../types';

// Season leaderboard (eng.1 goals / nba points, and — via a TopScorer→Leader
// map at the call site — tournament scoreboard scorers). Rows are NOT clickable
// (spec §2: no player-page nav from the board).
export default function LeadersView({
  leaders,
  statLabel,
  title = 'Top Scorers',
  subtitle = 'Golden Boot race',
  empty,
}: {
  leaders: Leader[];
  statLabel: string;
  title?: string;
  subtitle?: string;
  empty: string;
}) {
  if (leaders.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim">{empty}</p>;
  }

  return (
    <div className="space-y-card">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display font-bold text-lg text-chalk tracking-wide">{title}</h3>
        <span className="ds-caption uppercase tracking-[0.2em] text-chalkdim">{subtitle}</span>
      </div>

      <table className="w-full text-sm border border-line/30 bg-panel/85 rounded-card overflow-hidden shadow-panel backdrop-blur-sm">
        <caption className="sr-only">{title}</caption>
        <thead className="text-chalkdim ds-caption uppercase tracking-[0.18em]">
          <tr className="border-b border-overlay/5 bg-overlay/[0.02]">
            <th scope="col" className="text-left font-medium px-3 py-2 w-10">
              #
            </th>
            <th scope="col" className="text-left font-medium px-3 py-2">
              Player
            </th>
            <th scope="col" className="text-left font-medium px-3 py-2 hidden sm:table-cell">
              Team
            </th>
            <th scope="col" className="text-right font-medium px-3 py-2 w-16">
              {statLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {leaders.map((l) => {
            const isLeader = l.rank === 1;
            return (
              <tr
                key={l.rank}
                className={`border-b border-overlay/5 last:border-b-0 ${isLeader ? 'bg-pitch/5' : ''}`}
              >
                <td className="px-3 py-2 font-mono tabular-nums text-chalkdim">{l.rank}</td>
                <td className="px-3 py-2 font-display text-chalk truncate max-w-0">
                  {l.name}
                  <span className="flex items-center gap-1 sm:hidden ds-caption text-chalkdim">
                    {l.teamLogo && (
                      <img
                        src={l.teamLogo}
                        alt=""
                        className="w-3.5 h-2.5 object-cover rounded-card-inset shrink-0"
                      />
                    )}
                    <span className="truncate">{l.teamName}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-label text-chalkdim truncate max-w-0 hidden sm:table-cell">
                  <span className="flex items-center gap-1.5">
                    {l.teamLogo && (
                      <img
                        src={l.teamLogo}
                        alt=""
                        className="w-4 h-3 object-cover rounded-card-inset shrink-0"
                      />
                    )}
                    <span className="truncate">{l.teamName}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-base sm:text-lg font-bold text-chalk tabular-nums text-right">
                  {l.displayValue}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
