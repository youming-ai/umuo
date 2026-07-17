import type { TeamStatRow } from '../../types';

// ESPN sends %-labeled stats as fractions (0.3 → 30%), except Possession which
// arrives pre-scaled (60.5). Scale only fractional %-labeled values for display.
function fmt(label: string, v: string): string {
  const n = parseFloat(v);
  if (label.trim().endsWith('%') && Number.isFinite(n) && n <= 1) return `${Math.round(n * 100)}%`;
  return v;
}

// Width of the home side's bar, 0..100, when both values are numeric.
function homePct(home: string, away: string): number | null {
  const h = parseFloat(home);
  const a = parseFloat(away);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h + a === 0) return null;
  return (h / (h + a)) * 100;
}

export default function TeamStatsTab({ stats }: { stats: TeamStatRow[] }) {
  if (stats.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim p-card">No data yet</p>;
  }
  return (
    <div className="space-y-card p-card">
      {stats.map((s) => {
        const pct = homePct(s.home, s.away);
        return (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between font-mono text-sm text-chalk tabular-nums">
              <span className="font-bold">{fmt(s.label, s.home)}</span>
              <span className="text-chalkdim text-xs uppercase tracking-wider">{s.label}</span>
              <span className="font-bold">{fmt(s.label, s.away)}</span>
            </div>
            {pct !== null && (
              <div className="flex items-center h-2 gap-1.5 w-full mt-1.5 select-none">
                {/* Home side bar: right-aligned, grows to the left */}
                <div className="flex-1 bg-overlay/5 h-1.5 rounded-pill overflow-hidden flex justify-end">
                  <div
                    className={`${pct >= 50 ? 'bg-overlay' : 'bg-overlay/45'} h-full w-full rounded-pill origin-right transition-transform duration-300 ease-out`}
                    style={{ transform: `scaleX(${pct / 100})` }}
                  />
                </div>
                {/* Center marker */}
                <div className="w-[1px] h-2.5 bg-overlay/10 shrink-0" />
                {/* Away side bar: left-aligned, grows to the right */}
                <div className="flex-1 bg-overlay/5 h-1.5 rounded-pill overflow-hidden flex justify-start">
                  <div
                    className={`${pct < 50 ? 'bg-overlay' : 'bg-overlay/45'} h-full w-full rounded-pill origin-left transition-transform duration-300 ease-out`}
                    style={{ transform: `scaleX(${(100 - pct) / 100})` }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
