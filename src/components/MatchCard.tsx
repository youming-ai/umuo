import { memo, type ReactNode } from 'react';
import type { MatchProgress, MatchStatus, ScorerEntry } from '../types';
import { scorerDisplay, stageLabel } from '../utils/wc';
import { ReminderMenu } from './MatchActions';

interface MatchCardProps {
  homeName: string;
  awayName: string;
  homeFlag?: string;
  awayFlag?: string;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  kickoff: Date | null;
  stage?: string;
  group?: string;
  homeScorers?: ScorerEntry[];
  awayScorers?: ScorerEntry[];
  venue?: string;
  // Optional richer progress (clock + displayClock + period). When omitted
  // the card renders the legacy 3-state pill (live / ft / upcoming).
  progress?: MatchProgress;
  // Knockout decider (see CompMatch): tags the pill AET/Pens and, for pens,
  // resolves the winner the level aggregate score can't.
  finishType?: 'aet' | 'pens';
  homeShootoutScore?: number;
  awayShootoutScore?: number;
  winner?: 'home' | 'away';
  // ESPN-provided status line for non-soccer sports (e.g. "Final", "Q4 2:14",
  // "OT"). When present on a live/finished card it replaces the derived
  // StatusPill/ClockLabel — we don't synthesize period text for other sports.
  statusText?: string;
  /** Real match-detail URL. When set, the card body is an `<a href>` (middle-
   *  click / open-in-new-tab / copy link all work). */
  href?: string;
}

// What to render under the score on a live/HT card. Returns null for FT /
// upcoming (the FT pill is enough; upcoming shows kickoff time instead).
// During extra time (period >= 3) or penalties (period >= 5) we render
// short period tags ('ET', 'PEN') instead of a minute, since ET runs
// 91-120+ and penalties don't have a clock.
function ClockLabel({ progress }: { progress: MatchProgress | undefined }) {
  if (!progress) return null;
  if (progress.status === 'post') return null;
  if (progress.status === 'halftime') {
    return <span className="ds-caption tracking-widest uppercase text-amber">HT</span>;
  }
  if (progress.status === 'in') {
    if (progress.period >= 5) {
      return <span className="ds-caption tracking-widest uppercase text-live">PEN</span>;
    }
    if (progress.period >= 3) {
      return <span className="ds-caption tracking-widest uppercase text-live">ET</span>;
    }
    // Prefer ESPN's displayClock (e.g. "45'+2'"); fall back to a derived
    // value from the numeric clock field.
    const text =
      progress.displayClock || (progress.clock > 0 ? `${Math.floor(progress.clock)}'` : '');
    if (!text) return null;
    return <span className="ds-caption tracking-widest tabular-nums text-live">{text}</span>;
  }
  return null;
}

function StatusPill({
  status,
  progress,
  finishType,
}: {
  status: MatchStatus;
  progress: MatchProgress | undefined;
  finishType: 'aet' | 'pens' | undefined;
}) {
  // Halftime: distinct amber pill so it's visible at a glance and never
  // confused with a regular in-progress minute.
  if (progress?.status === 'halftime') {
    return <span className="ds-caption tracking-widest text-amber">Half-time</span>;
  }
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1 ds-caption tracking-widest text-live">
        <span className="live-dot" />
        LIVE
      </span>
    );
  }
  if (status === 'finished') {
    const label =
      finishType === 'pens' ? 'Pens' : finishType === 'aet' ? 'AET' : 'Final';
    return <span className="ds-caption tracking-widest text-chalkdim">{label}</span>;
  }
  return (
    <span className="ds-caption tracking-widest text-chalkdim/70">Upcoming</span>
  );
}

function Flag({ src, alt, dim }: { src?: string; alt: string; dim?: boolean }) {
  const cls = dim ? 'opacity-50' : '';
  const size = 'w-8 h-6 sm:w-10 sm:h-7';
  if (!src) return <div className={`${size} bg-overlay/5 rounded-micro ${cls}`} aria-hidden />;
  return <img src={src} alt={alt} className={`${size} object-cover rounded-micro ${cls}`} />;
}

function CardBodyShell({
  href,
  className,
  children,
}: {
  href?: string;
  className: string;
  children: ReactNode;
}) {
  if (href) return <a href={href} className={className}>{children}</a>;
  return <div className={className}>{children}</div>;
}

export default memo(function MatchCard({
  homeName,
  awayName,
  homeFlag,
  awayFlag,
  homeScore,
  awayScore,
  status,
  kickoff,
  stage,
  group,
  homeScorers = [],
  awayScorers = [],
  venue,
  progress,
  finishType,
  homeShootoutScore,
  awayShootoutScore,
  winner,
  statusText,
  href,
}: MatchCardProps) {
  const tbd = 'TBD';
  const stageText = stage ? stageLabel(stage, group) : '';

  // finished: brighten the winner, dim the loser. Prefer ESPN's explicit
  // winner (set on knockout games) so a pens win resolves where the
  // aggregate is level; fall back to the score for group games.
  const homeWon =
    status === 'finished' && (winner ? winner === 'home' : (homeScore ?? 0) > (awayScore ?? 0));
  const awayWon =
    status === 'finished' && (winner ? winner === 'away' : (awayScore ?? 0) > (homeScore ?? 0));
  // Penalty score in parens, mirrored around the colon like the detail page:
  // "1 (3) : (4) 1". Away needs a before-colon form for the compact score and
  // an after-name form for the screen-reader announcement ("Paraguay 1 (4)").
  const homeSO = homeShootoutScore != null ? ` (${homeShootoutScore})` : '';
  const awaySObefore = awayShootoutScore != null ? `(${awayShootoutScore}) ` : '';
  const awaySOafter = awayShootoutScore != null ? ` (${awayShootoutScore})` : '';
  const teamCls = (won: boolean, lost: boolean) =>
    `font-display text-sm text-center truncate w-full ${
      lost ? 'font-normal text-chalkdim' : won ? 'font-bold text-chalk' : 'font-semibold text-chalk'
    }`;

  const clickable = Boolean(href);
  return (
    // Outer frame holds the border/radius but NOT overflow-hidden, so the
    // reminder dropdown can spill past the card edge without being clipped.
    // The clickable region (`<a href>`) and the action footer are siblings —
    // not nested — so a footer click can't activate the link.
    <div
      className={`block w-full rounded-card border border-line bg-panel shadow-panel transition-all duration-200 ${
        clickable ? 'hover:border-pitch' : 'hover:border-chalkdim'
      }`}
    >
      <CardBodyShell
        href={href}
        className={`block w-full text-left rounded-t-card overflow-hidden ${
          clickable ? 'cursor-pointer' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5 border-b border-line bg-panel2/10">
          <div className="flex items-center gap-2 min-w-0">
            {stageText && (
              <span className="ds-caption uppercase tracking-[0.18em] text-chalkdim truncate">
                {stageText}
              </span>
            )}
            {venue && (
              <span className="ds-caption text-chalkdim/60 truncate hidden sm:inline" title={venue}>
                · {venue}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {kickoff && (
              <span className="ds-caption tabular-nums text-chalkdim/70">
                {kickoff.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2.5 sm:py-3">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <Flag src={homeFlag} alt={homeName || tbd} dim={awayWon} />
            <span className={teamCls(homeWon, awayWon)}>{homeName || tbd}</span>
            {homeScorers.length > 0 && (
              <ul className="space-y-0.5 ds-caption text-chalkdim leading-tight text-center min-w-0 max-w-full">
                {homeScorers.slice(0, 3).map((s) => (
                  <li key={s.playerId + s.minute} className="truncate px-1">
                    ⚽ {scorerDisplay(s)}
                  </li>
                ))}
                {homeScorers.length > 3 && (
                  <li className="text-chalkdim/60">+{homeScorers.length - 3} more</li>
                )}
              </ul>
            )}
          </div>

          <div className="flex flex-col items-center gap-1 px-1 sm:px-2">
            {status === 'upcoming' ? (
              <span className="font-mono text-sm sm:text-lg font-bold text-chalk tabular-nums whitespace-nowrap leading-none">
                {kickoff
                  ? kickoff.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                  : tbd}
              </span>
            ) : (
              <span className="font-mono text-2xl sm:text-4xl font-bold text-chalk tabular-nums leading-none whitespace-nowrap">
                {/* Screen-reader-friendly full-score announcement; visually hidden. */}
                <span className="sr-only">
                  {`${homeName || tbd} ${homeScore ?? 0}${homeSO} - ${awayName || tbd} ${awayScore ?? 0}${awaySOafter}`}
                </span>
                <span
                  aria-hidden
                >{`${homeScore ?? 0}${homeSO} : ${awaySObefore}${awayScore ?? 0}`}</span>
              </span>
            )}
            {statusText && status !== 'upcoming' ? (
              <span
                className={`ds-caption tracking-widest ${
                  status === 'live' ? 'text-live' : 'text-chalkdim'
                }`}
              >
                {statusText}
              </span>
            ) : (
              <>
                <StatusPill status={status} progress={progress} finishType={finishType} />
                <ClockLabel progress={progress} />
              </>
            )}
          </div>

          <div className="flex flex-col items-center gap-1 min-w-0">
            <Flag src={awayFlag} alt={awayName || tbd} dim={homeWon} />
            <span className={teamCls(awayWon, homeWon)}>{awayName || tbd}</span>
            {awayScorers.length > 0 && (
              <ul className="space-y-0.5 ds-caption text-chalkdim leading-tight text-center min-w-0 max-w-full">
                {awayScorers.slice(0, 3).map((s) => (
                  <li key={s.playerId + s.minute} className="truncate px-1">
                    {scorerDisplay(s)} ⚽
                  </li>
                ))}
                {awayScorers.length > 3 && (
                  <li className="text-chalkdim/60">+{awayScorers.length - 3} more</li>
                )}
              </ul>
            )}
          </div>
        </div>

        {venue && (
          <div className="px-3 py-1.5 border-t border-overlay/5 sm:hidden">
            <span className="ds-caption text-chalkdim/70 truncate block">{venue}</span>
          </div>
        )}
      </CardBodyShell>

      {status === 'upcoming' && kickoff && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-t border-line bg-panel2/10 rounded-b-card">
          <ReminderMenu title={`${homeName || tbd} vs ${awayName || tbd}`} start={kickoff} />
        </div>
      )}
    </div>
  );
});