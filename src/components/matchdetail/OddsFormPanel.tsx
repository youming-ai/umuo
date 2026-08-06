import type { TeamForm } from '../../adapters/summaryExtras';
import type { MatchOdds } from '../../types';

function OddsPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3">
      <span className="ds-caption uppercase tracking-caption text-chalkdim">{label}</span>
      <span className="font-mono text-sm font-bold text-chalk tabular-nums">{value}</span>
    </div>
  );
}

// Sport-agnostic panel above the match-detail tabs: betting line + each team's
// recent form, both pulled from the ESPN summary payload. Renders nothing when
// the upstream provides neither.
export default function OddsFormPanel({
  odds,
  form,
}: {
  odds: MatchOdds | null;
  form: TeamForm[];
}) {
  if (!odds && form.length === 0) return null;
  return (
    <div className="ds-glass p-card flex flex-col gap-3">
      {odds && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <span className="ds-caption uppercase tracking-caption text-chalkdim pr-2">
            {odds.provider || 'Odds'}
          </span>
          {odds.details && <OddsPill label="Line" value={odds.details} />}
          {odds.spread !== null && <OddsPill label="Spread" value={String(odds.spread)} />}
          {odds.overUnder !== null && <OddsPill label="O/U" value={String(odds.overUnder)} />}
          {odds.homeMoneyLine !== null && (
            <OddsPill
              label="Home ML"
              value={`${odds.homeMoneyLine > 0 ? '+' : ''}${odds.homeMoneyLine}`}
            />
          )}
          {odds.drawMoneyLine != null && (
            <OddsPill
              label="Draw"
              value={`${odds.drawMoneyLine > 0 ? '+' : ''}${odds.drawMoneyLine}`}
            />
          )}
          {odds.awayMoneyLine !== null && (
            <OddsPill
              label="Away ML"
              value={`${odds.awayMoneyLine > 0 ? '+' : ''}${odds.awayMoneyLine}`}
            />
          )}
        </div>
      )}
      {form.length > 0 && (
        <div className="flex flex-col items-center justify-center gap-x-6 gap-y-2 sm:flex-row">
          {form.map((f) => (
            <div key={f.teamId} className="flex items-center gap-2">
              <span className="font-display text-sm text-chalk truncate max-w-[10rem]">
                {f.teamName}
              </span>
              <span className="inline-flex gap-1">
                {f.results.map((r, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length recent-form list, never reordered within a render
                    key={i}
                    title={r}
                    className={`grid h-4 w-4 place-items-center rounded-micro text-[10px] font-bold text-onaccent ${
                      r === 'W' ? 'bg-pitch' : r === 'L' ? 'bg-live' : 'bg-chalkdim'
                    }`}
                  >
                    {r}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
