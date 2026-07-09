import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { useMatchDetail } from '../hooks/useMatchDetail';
import { COMPETITIONS } from '../competitions';
import type { MatchDetail } from '../adapters/types';
import type { CompMatch } from '../types';
import { pathFor, useRouter } from '../utils/router';
import { stageLabel } from '../utils/wc';
import BoxscoreTab from './matchdetail/BoxscoreTab';
import LineupTab from './matchdetail/LineupTab';
import PlayByPlayTab from './matchdetail/PlayByPlayTab';
import TeamStatsTab from './matchdetail/TeamStatsTab';

type Tab = 'stats' | 'play' | 'lineup' | 'boxscore';

const TAB_LABELS: Record<Tab, string> = {
  stats: 'Stats',
  play: 'Play-By-Play',
  lineup: 'Lineup',
  boxscore: 'Box Score',
};

function StatusBadge({
  status,
  progress,
  finishType,
}: {
  status: 'upcoming' | 'live' | 'finished';
  progress: CompMatch['progress'];
  finishType: CompMatch['finishType'];
}) {
  if (status === 'live') {
    const isHT = progress?.status === 'halftime';
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-pill ds-caption font-bold tracking-wider uppercase select-none ${
          isHT
            ? 'bg-amber/25 text-amber border border-amber/30'
            : 'bg-live/25 text-live border border-live/30'
        }`}
      >
        {!isHT && <span className="w-1.5 h-1.5 rounded-pill bg-live animate-pulse" />}
        {isHT ? 'Half-time' : progress?.displayClock || 'LIVE'}
      </span>
    );
  }
  if (status === 'finished') {
    // Knockout finishes carry an AET / Pens tag instead of the plain FT.
    const label =
      finishType === 'pens' ? 'Pens' : finishType === 'aet' ? 'AET' : 'Final';
    return (
      <span className="inline-flex items-center px-3 py-0.5 rounded-pill bg-chalkdim/10 text-chalkdim border border-overlay/10 ds-caption font-bold tracking-wider uppercase select-none">
        {label}
      </span>
    );
  }
  return null;
}

// Hero team crest + name. Links to the team page only when one exists for
// this competition — team pages resolve from soccer standings, so basketball
// (NBA) has none and the badge renders as plain text instead of a dead link.
function TeamBadge({ flag, name, href }: { flag: string; name: string; href?: string }) {
  const inner = (
    <>
      <div className="w-14 h-10 md:w-20 md:h-14 overflow-hidden rounded-card bg-panel2 shadow-hero mb-3 shrink-0">
        {flag ? (
          <img src={flag} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-panel2" />
        )}
      </div>
      <span className="font-display text-base md:text-xl font-bold text-chalk truncate max-w-full">
        {name}
      </span>
    </>
  );
  const cls = 'flex-1 flex flex-col items-center text-center min-w-0';
  return href ? (
    <a href={href} className={`${cls} hover:opacity-80 transition-opacity`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function MatchDetailPage({
  match,
  backHref,
  initialDetail,
}: {
  match: CompMatch;
  /** Schedule URL for the up-navigation control (real `<a href>`). */
  backHref: string;
  initialDetail?: MatchDetail | null;
}) {
  const { route } = useRouter();
  const { detail, loading, error, reload } = useMatchDetail(match.id, route.comp, initialDetail);
  const [tab, setTab] = useState<Tab>('stats');

  const homeId = detail?.homeId ?? '';

  // Team pages only exist for soccer competitions (they read soccer standings);
  // gate the crest links so NBA match headers don't link to a "Team not found".
  const teamHref = (teamId: string) =>
    COMPETITIONS[route.comp]?.sport === 'soccer'
      ? pathFor({ kind: 'team', comp: route.comp, teamId })
      : undefined;

  const tabs: Tab[] =
    detail?.kind === 'basketball' ? ['boxscore', 'stats'] : ['stats', 'play', 'lineup'];

  // Reset to the current sport's primary tab whenever detail.kind changes —
  // covers both landing on a fresh detail (e.g. basketball should open on
  // 'boxscore', not carry over the 'stats' initial state) and switching sport
  // away from a tab the new kind doesn't have (e.g. soccer 'lineup').
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs is derived from detail
  useEffect(() => {
    setTab(tabs[0]!);
  }, [detail?.kind]);

  // Wrap tab navigation in a button-onclick trap so keyboard users can
  // Tab between the tab buttons without leaving the page header.
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.indexOf(tab);
    const next =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : tabs[(i + tabs.length - 1) % tabs.length];
    if (next) setTab(next);
  };

  return (
    // Width + page padding come from the app shell; stack sections only.
    <div className="space-y-section">
        {/* Back navigation */}
        <div>
          <a
            href={backHref}
            className="font-mono text-xs tracking-widest text-chalkdim hover:text-chalk transition-colors inline-flex items-center gap-1.5 py-1"
            aria-label="Back"
          >
            ← <span>Back</span>
          </a>
        </div>

        {/* Hero Scoreboard (Apple Sports style) */}
        <div className="ds-glass-hero p-card md:p-8 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Subtle radial glow background circles */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-pitch/5 rounded-pill blur-3xl pointer-events-none select-none" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-live/5 rounded-pill blur-3xl pointer-events-none select-none" />
          {/* Stage/Group Label */}
          {match.stage && (
            <div className="text-center mb-4 shrink-0">
              <span className="ds-caption uppercase tracking-[0.2em] text-chalkdim">
                {stageLabel(match.stage, match.group)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between w-full max-w-2xl gap-card">
            {/* Home Team */}
            <TeamBadge flag={match.homeFlag} name={match.homeName} href={teamHref(match.homeId)} />

            {/* Score & Status */}
            <div className="flex flex-col items-center justify-center shrink-0 px-2 sm:px-6">
              {match.status === 'upcoming' ? (
                <div className="text-center">
                  <span className="font-mono text-xl md:text-3xl font-black tracking-wider text-chalk">
                    {match.kickoff
                      ? match.kickoff.toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                      : 'TBD'}
                  </span>
                  {match.kickoff && (
                    <div className="ds-caption text-chalkdim mt-1.5">
                      {match.kickoff.toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center gap-card sm:gap-8 font-display text-4xl md:text-6xl font-black text-chalk tabular-nums select-none leading-none">
                    {/* Penalty-shootout score (when decided on pens) sits beside
                        each team's aggregate as a smaller pitch-colored number. */}
                    <span>
                      {match.homeScore ?? 0}
                      {match.homeShootoutScore != null && (
                        <sup className="ml-0.5 text-xl md:text-2xl font-bold text-pitch">
                          ({match.homeShootoutScore})
                        </sup>
                      )}
                    </span>
                    <span className="text-chalkdim/30 text-2xl md:text-3xl font-light font-body select-none">
                      :
                    </span>
                    <span>
                      {match.awayShootoutScore != null && (
                        <sup className="mr-0.5 text-xl md:text-2xl font-bold text-pitch">
                          ({match.awayShootoutScore})
                        </sup>
                      )}
                      {match.awayScore ?? 0}
                    </span>
                  </div>
                  <div className="mt-3">
                    <StatusBadge
                      status={match.status}
                      progress={match.progress}
                      finishType={match.finishType}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Away Team */}
            <TeamBadge flag={match.awayFlag} name={match.awayName} href={teamHref(match.awayId)} />
          </div>
        </div>

        {/* Tab List (Segmented Control style) */}
        <div
          role="tablist"
          aria-label="Match detail tabs"
          onKeyDown={onTabKey}
          className="ds-segmented-blur w-full"
        >
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              onClick={() => setTab(k)}
              aria-selected={tab === k}
              className={`flex-1 ds-seg-tab ${
                tab === k ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'
              }`}
            >
              {TAB_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="ds-glass-hero p-card min-h-32">
          {loading ? (
            <p className="font-mono text-xs tracking-[0.3em] text-pitch animate-pulse p-card text-center">
              Loading…
            </p>
          ) : error ? (
            <div className="p-card text-center space-y-3">
              <p className="font-mono text-xs text-live">Failed to load data</p>
              <button
                type="button"
                onClick={reload}
                className="font-display text-sm text-chalk border border-overlay/10 rounded-pill px-5 py-1.5 hover:border-pitch hover:bg-overlay/5 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : detail && detail.kind === 'soccer' ? (
            <>
              {tab === 'stats' && <TeamStatsTab stats={detail.stats} />}
              {tab === 'play' && (
                <PlayByPlayTab
                  allPlays={detail.allPlays}
                  keyPlays={detail.keyPlays}
                  homeId={homeId}
                />
              )}
              {tab === 'lineup' && <LineupTab lineups={detail.lineups} homeId={homeId} />}
              {(detail.venue || detail.attendance) && (
                <div className="pt-card mt-card border-t border-overlay/5 ds-caption text-chalkdim space-y-1.5">
                  {detail.venue && <div>{detail.venue}</div>}
                  {detail.attendance && (
                    <div>
                      Attendance: {detail.attendance.toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : detail && detail.kind === 'basketball' ? (
            <>
              {tab === 'boxscore' && <BoxscoreTab tables={detail.playerTables} />}
              {tab === 'stats' && <TeamStatsTab stats={detail.teamStats} />}
              {(detail.venue || detail.attendance) && (
                <div className="pt-card mt-card border-t border-overlay/5 ds-caption text-chalkdim space-y-1.5">
                  {detail.venue && <div>{detail.venue}</div>}
                  {detail.attendance && (
                    <div>
                      Attendance: {detail.attendance.toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
    </div>
  );
}