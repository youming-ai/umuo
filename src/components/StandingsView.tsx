import { useMemo } from 'react';
import type { WCGroup } from '../types';

// Last-5 form pill. Renders each W/D/L as a colour-coded square.
//   W = win  (pitch green)
//   D = draw (chalkdim, dim)
//   L = loss (live red)
// The visual letter is also announced to screen readers via a visually-
// hidden span, and `title` gives mouse users a hover tooltip.
function FormPill({ form }: { form?: string }) {
  if (!form) return <span className="text-chalkdim">—</span>;
  // The wrapping element uses role="img" + aria-label so screen readers
  // hear a single "WLWLL" string. The role is required because
  // aria-label on a plain <span> isn't a valid a11y hook.
  return (
    <span
      role="img"
      aria-label={`Last 5 matches: ${form}`}
      className="inline-flex gap-0.5 justify-center"
    >
      {form.split('').map((c, _i, arr) => {
        const label = c === 'W' ? 'win' : c === 'D' ? 'draw' : 'loss';
        // Form is at most 5 chars; a position-prefixed key like
        // "W-0" / "D-1" is stable across renders and lets the key encode
        // both identity and position without re-introducing array-index
        // lint complaints.
        const key = `${c}-${arr.length - 1 - _i}`;
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

export default function StandingsView({
  groups,
  mode = 'group',
}: {
  groups: WCGroup[];
  mode?: 'group' | 'league';
}) {
  // WC2026 出线：每组前 2 名 + 跨组 8 个成绩最好的第三名 → 32 强。
  // 这里按 pts→gd→gf 给所有第三名排序，取前 8 个标记为"最佳第三名"出线。
  const bestThirdIds = useMemo(() => {
    const thirds = groups.map((g) => g.standings[2]).filter(Boolean);
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return new Set(thirds.slice(0, 8).map((tm) => tm.teamId));
  }, [groups]);

  if (groups.length === 0) {
    return (
      <p className="font-mono text-xs tracking-wider text-chalkdim">
        Standings appear once the group stage kicks off
      </p>
    );
  }

  return (
    <div className="space-y-section">
      {/* 出线图例 */}
      {mode === 'group' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 ds-caption uppercase tracking-wider text-chalkdim">
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-3 bg-pitch" />
            Top 2 advance
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-3 bg-pitch/40" />8 best third-placed teams advance
          </span>
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-3 sm:gap-card ${mode === 'group' ? 'sm:grid-cols-2' : ''}`}
      >
        {groups.map((g) => (
          <div key={g.name} className="ds-glass overflow-hidden">
            <div className="px-4 py-3 border-b border-overlay/5 bg-overlay/[0.02]">
              <span className="font-display font-bold text-lg text-chalk">
                {mode === 'group' ? `Group ${g.name}` : g.name}
              </span>
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">{mode === 'group' ? `Group ${g.name}` : g.name}</caption>
              <thead>
                <tr className="text-chalkdim ds-caption uppercase">
                  <th scope="col" className="text-left font-medium px-4 py-2">
                    Team
                  </th>
                  <th scope="col" className="px-1 font-medium">
                    <abbr title="Matches Played">MP</abbr>
                  </th>
                  <th scope="col" className="px-1 font-medium hidden sm:table-cell">
                    <abbr title="Wins">W</abbr>
                  </th>
                  <th scope="col" className="px-1 font-medium hidden sm:table-cell">
                    <abbr title="Draws">D</abbr>
                  </th>
                  <th scope="col" className="px-1 font-medium hidden sm:table-cell">
                    <abbr title="Losses">L</abbr>
                  </th>
                  <th scope="col" className="px-1 font-medium">
                    <abbr title="Goal Difference">GD</abbr>
                  </th>
                  <th scope="col" className="px-2 font-medium hidden sm:table-cell">
                    <abbr title="Last 5 matches">Form</abbr>
                  </th>
                  <th scope="col" className="px-2 font-medium">
                    <abbr title="Points">Pts</abbr>
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.standings.map((s, i) => {
                  const qual =
                    mode === 'league'
                      ? 'none'
                      : i < 2
                        ? 'direct'
                        : i === 2 && bestThirdIds.has(s.teamId)
                          ? 'third'
                          : 'none';
                  return (
                    <tr
                      key={s.teamId}
                      className={`border-t border-overlay/5 ${
                        qual === 'direct'
                          ? 'bg-pitch/[0.06]'
                          : qual === 'third'
                            ? 'bg-pitch/[0.03]'
                            : ''
                      }`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-1 h-4 ${
                              qual === 'direct'
                                ? 'bg-pitch'
                                : qual === 'third'
                                  ? 'bg-pitch/40'
                                  : 'bg-transparent'
                            }`}
                          />
                          {s.flag ? (
                            <img
                              src={s.flag}
                              alt={s.name}
                              className="w-5 h-3.5 object-cover rounded-micro"
                            />
                          ) : (
                            <span className="w-5" />
                          )}
                          <span className="font-display font-semibold text-chalk truncate">
                            {s.name}
                          </span>
                        </div>
                      </td>
                      <td className="text-center text-chalkdim tabular-nums">{s.mp}</td>
                      <td className="text-center text-chalkdim tabular-nums hidden sm:table-cell">
                        {s.w}
                      </td>
                      <td className="text-center text-chalkdim tabular-nums hidden sm:table-cell">
                        {s.d}
                      </td>
                      <td className="text-center text-chalkdim tabular-nums hidden sm:table-cell">
                        {s.l}
                      </td>
                      <td className="text-center text-chalkdim tabular-nums">
                        {s.gd > 0 ? `+${s.gd}` : s.gd}
                      </td>
                      <td className="text-center tabular-nums hidden sm:table-cell">
                        <FormPill form={s.form} />
                      </td>
                      <td className="text-center font-bold text-chalk tabular-nums">{s.pts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
