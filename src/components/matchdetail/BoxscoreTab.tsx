import type { BoxscoreTable } from '../../adapters/types';

export default function BoxscoreTab({ tables }: { tables: BoxscoreTable[] }) {
  if (tables.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim p-card">No data yet</p>;
  }
  return (
    <div className="space-y-card p-card">
      {tables.map((tbl) => (
        <div key={tbl.teamId} className="space-y-2">
          <h4 className="font-display font-bold text-sm text-chalk">{tbl.teamName}</h4>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="text-chalkdim ds-caption uppercase">
                  <th scope="col" className="text-left font-medium px-2 py-1.5">
                    Player
                  </th>
                  {tbl.labels.map((label) => (
                    <th key={label} scope="col" className="px-2 py-1.5 font-medium text-right">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tbl.players.map((p) => (
                  <tr key={p.name} className="border-t border-overlay/5">
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span
                        className={`font-display ${p.dnp ? 'text-chalkdim' : 'text-chalk'} ${
                          p.starter ? 'font-semibold' : 'font-normal'
                        }`}
                      >
                        {p.name}
                      </span>
                    </td>
                    {p.dnp ? (
                      <td
                        colSpan={tbl.labels.length}
                        className="px-2 py-1.5 text-chalkdim ds-caption uppercase tracking-wider"
                      >
                        DNP
                      </td>
                    ) : (
                      tbl.labels.map((label, i) => (
                        <td
                          key={label}
                          className="px-2 py-1.5 text-right text-chalkdim tabular-nums"
                        >
                          {p.stats[i] ?? ''}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
