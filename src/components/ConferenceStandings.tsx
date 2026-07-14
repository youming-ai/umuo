import type { ConferenceTable } from '../adapters/types';

export default function ConferenceStandings({ conferences }: { conferences: ConferenceTable[] }) {
  if (conferences.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim">No results found</p>;
  }

  return (
    <div className="space-y-section">
      <div className="grid grid-cols-1 gap-3 sm:gap-card sm:grid-cols-2">
        {conferences.map((c) => (
          <div key={c.name} className="ds-glass overflow-hidden">
            <div className="px-4 py-3 border-b border-overlay/5 bg-overlay/[0.02]">
              <span className="font-display font-bold text-lg text-chalk">{c.name}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-chalkdim ds-caption uppercase">
                  <th scope="col" className="text-left font-medium px-4 py-2">
                    Team
                  </th>
                  <th scope="col" className="px-1 font-medium">
                    <abbr title="Wins">W</abbr>
                  </th>
                  <th scope="col" className="px-1 font-medium">
                    <abbr title="Losses">L</abbr>
                  </th>
                  <th scope="col" className="px-2 font-medium">
                    <abbr title="Win percentage">PCT</abbr>
                  </th>
                  <th scope="col" className="px-2 font-medium hidden sm:table-cell">
                    <abbr title="Games behind">GB</abbr>
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.teamId} className="border-t border-overlay/5">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.logo ? (
                          <img
                            src={r.logo}
                            alt={r.name}
                            className="w-5 h-5 object-contain rounded-micro"
                          />
                        ) : (
                          <span className="w-5" />
                        )}
                        <span className="font-display font-semibold text-chalk truncate">
                          {r.name}
                        </span>
                      </div>
                    </td>
                    <td className="text-center text-chalkdim tabular-nums">{r.w}</td>
                    <td className="text-center text-chalkdim tabular-nums">{r.l}</td>
                    <td className="text-center text-chalkdim tabular-nums">{r.pct}</td>
                    <td className="text-center text-chalkdim tabular-nums hidden sm:table-cell">
                      {r.gb}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
