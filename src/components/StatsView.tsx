import type { Leaderboard } from '../leaders';
import LeadersView from './LeadersView';

// ESPN-style multi-category stats page: leaderboards grouped by their `group`
// (Scoring / Discipline / …), each board a compact top-N table. Reuses
// LeadersView per board so the row/logo rendering stays in one place.
export default function StatsView({ boards }: { boards: Leaderboard[] }) {
  if (boards.length === 0) {
    return (
      <p className="font-mono text-xs tracking-wider text-chalkdim">No stats available yet.</p>
    );
  }

  // Preserve first-seen group order (the spec order from LEADERBOARDS_BY_SPORT).
  const groups: string[] = [];
  for (const b of boards) if (!groups.includes(b.group)) groups.push(b.group);

  return (
    <div className="space-y-section">
      {groups.map((group) => (
        <section key={group} className="space-y-card">
          <h2 className="font-display font-bold text-xl text-chalk tracking-wide">{group}</h2>
          <div className="grid gap-card sm:grid-cols-2">
            {boards
              .filter((b) => b.group === group)
              .map((b) => (
                <LeadersView
                  key={b.key}
                  leaders={b.leaders}
                  statLabel={b.label}
                  title={b.label}
                  subtitle={group}
                  empty="No data yet"
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
