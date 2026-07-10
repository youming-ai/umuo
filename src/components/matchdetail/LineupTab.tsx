import { useState } from 'react';
import type { LineupPlayer, TeamLineup } from '../../types';
import { layoutStarters } from '../../utils/espn';

function Pitch({ starters }: { starters: LineupPlayer[] }) {
  const placed = layoutStarters(starters);
  return (
    <div className="relative w-full max-w-md mx-auto aspect-[3/4] bg-gradient-to-b from-pitch/15 to-night rounded-card border border-overlay/5 overflow-hidden shadow-inner">
      {/* Center Line */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-overlay/10" />
      {/* Center Circle */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-pill border border-overlay/10" />
      {/* Center Dot */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-pill bg-overlay/20" />
      {/* Top Penalty Box */}
      <div className="absolute inset-x-12 top-0 h-16 border-b border-x border-overlay/10 rounded-b-md" />
      {/* Bottom Penalty Box */}
      <div className="absolute inset-x-12 bottom-0 h-16 border-t border-x border-overlay/10 rounded-t-md" />

      {placed.map((p) => (
        <div
          key={p.jersey + p.name}
          className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-1/2 w-16 text-center select-none"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
        >
          <span className="flex items-center justify-center w-8 h-8 bg-panel border border-overlay/20 rounded-pill font-mono text-xs text-chalk font-bold shadow-panel">
            {p.jersey}
          </span>
          <span className="font-body text-caption text-onscrim font-semibold truncate w-full mt-1 bg-scrim/60 px-1 py-0.5 rounded shadow-sm">
            {p.name}
          </span>
          {p.card && (
            <span
              className={`mt-1 w-2 h-3 rounded-[1px] shadow-sm ${p.card === 'red' ? 'bg-live' : 'bg-amber'}`}
              aria-hidden
            />
          )}
          {p.subbedOutAt && (
            <span className="ds-caption text-live font-semibold mt-0.5">↓ {p.subbedOutAt}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Bench({ players }: { players: LineupPlayer[] }) {
  const subs = players.filter((p) => !p.starter);
  if (subs.length === 0) return null;
  return (
    <div className="mt-6 bg-overlay/5 rounded-card p-card border border-overlay/5">
      <h4 className="ds-caption uppercase tracking-[0.2em] text-chalkdim mb-3">Bench</h4>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {subs.map((p) => (
          <li
            key={p.jersey + p.name}
            className="flex items-center gap-2.5 font-body text-sm text-chalkdim py-1 border-b border-overlay/5 last:border-b-0"
          >
            <span className="font-mono text-xs w-6 text-right font-bold text-chalkdim">
              {p.jersey}
            </span>
            <span className="text-chalk font-medium flex-1 truncate">{p.name}</span>
            {p.card && (
              <span className={`w-2.5 h-3.5 ${p.card === 'red' ? 'bg-live' : 'bg-amber'}`} />
            )}
            {p.subbedInAt && (
              <span className="ds-caption text-pitch font-semibold bg-pitch/10 px-1.5 py-0.5 rounded">
                ↑ {p.subbedInAt}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LineupTab({ lineups, homeId }: { lineups: TeamLineup[]; homeId: string }) {
  const [side, setSide] = useState<'home' | 'away'>('home');
  if (lineups.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim p-card">No data yet</p>;
  }
  const home = lineups.find((l) => l.teamId === homeId) ?? lineups[0];
  const away = lineups.find((l) => l.teamId !== homeId) ?? lineups[1] ?? home;
  const team = side === 'home' ? home : away;

  const toggle = (
    <div className="ds-segmented w-full max-w-md mx-auto">
      {(['home', 'away'] as const).map((s) => {
        const lineup = s === 'home' ? home : away;
        return (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            aria-pressed={side === s}
            className={`flex-1 ds-seg-tab ${
              side === s ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'
            }`}
          >
            {lineup.teamName} · {lineup.formation}
          </button>
        );
      })}
    </div>
  );

  if (team.players.length === 0) {
    return (
      <div className="space-y-card">
        {toggle}
        <p className="font-mono text-xs tracking-wider text-chalkdim p-2 text-center">
          No data yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-card">
      {toggle}
      <div className="ds-caption uppercase tracking-[0.2em] text-chalkdim text-center">
        Starting Lineup · <span>{team.formation}</span>
      </div>
      <Pitch starters={team.players.filter((p) => p.starter)} />
      <Bench players={team.players} />
    </div>
  );
}
