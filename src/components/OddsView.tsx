import type { CompMatch } from '../types';
import LocalTime from './LocalTime';

// American-style moneyline: positive prices carry a leading '+', everything
// else prints as-is; null (feed omitted the price) shows an em dash.
function moneyLine(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v > 0 ? `+${v}` : String(v);
}

function OddsStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="ds-caption uppercase tracking-data text-chalkdim">{label}</span>
      <span className="font-bold text-chalk">{value}</span>
    </span>
  );
}

function TeamLine({ name, flag }: { name: string; flag: string }) {
  return (
    <div className="flex items-center gap-2 font-display text-sm font-semibold text-chalk">
      {flag && <img src={flag} alt="" className="h-4 w-4 shrink-0 object-contain" />}
      <span className="truncate">{name}</span>
    </div>
  );
}

function OddsRow({ match }: { match: CompMatch }) {
  const o = match.odds;
  if (!o) return null;
  return (
    <li className="ds-glass p-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <TeamLine name={match.homeName} flag={match.homeFlag} />
          <TeamLine name={match.awayName} flag={match.awayFlag} />
        </div>
        {match.kickoff && (
          <LocalTime
            date={match.kickoff}
            options={{ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }}
            className="ds-caption shrink-0 tabular-nums text-chalkdim"
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-overlay/5 pt-2.5 font-mono text-xs tabular-nums">
        <span className="ds-caption uppercase tracking-caption text-chalkdim">
          {o.provider || 'Odds'}
        </span>
        <OddsStat label="Home" value={moneyLine(o.homeMoneyLine)} />
        {o.drawMoneyLine != null && <OddsStat label="Draw" value={moneyLine(o.drawMoneyLine)} />}
        <OddsStat label="Away" value={moneyLine(o.awayMoneyLine)} />
        {o.spread != null && <OddsStat label="Spread" value={String(o.spread)} />}
        {o.overUnder != null && <OddsStat label="O/U" value={String(o.overUnder)} />}
      </div>
    </li>
  );
}

// Per-competition betting lines. Each match carries odds parsed from the
// scoreboard feed (no extra requests); we list the matches that have a line,
// soonest kickoff first. Matches without odds are dropped, not shown blank.
export default function OddsView({ matches }: { matches: CompMatch[] }) {
  const withOdds = matches
    .filter((m) => m.odds)
    .sort((a, b) => (a.kickoff?.getTime() ?? Infinity) - (b.kickoff?.getTime() ?? Infinity));

  if (withOdds.length === 0) {
    return <p className="font-mono text-xs tracking-wider text-chalkdim">No odds available.</p>;
  }
  return (
    <ul className="space-y-card">
      {withOdds.map((m) => (
        <OddsRow key={m.id} match={m} />
      ))}
    </ul>
  );
}
