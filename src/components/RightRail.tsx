import { useT } from '../i18n';
import type { CompMatch, TopScorer, Match } from '../types';
import type { StandingsData } from '../adapters/types';
import { navigate, pathFor, useRouter } from '../utils/router';
import { liveStreamForMatch } from '../utils/streamMatch';
import { useMemo, useState } from 'react';
import { Tv, ListOrdered, Award } from 'lucide-react';
import { COMPETITIONS } from '../competitions';
import { useLeaders } from '../hooks/useLeaders';

interface RightRailProps {
  matches: CompMatch[];
  standings: StandingsData;
  scorers: TopScorer[];
  streamIndex: Map<string, Match>;
  watchableSlugs: ReadonlySet<string>;
}

export default function RightRail({
  matches,
  standings,
  scorers,
  streamIndex,
  watchableSlugs,
}: RightRailProps) {
  const t = useT();
  const { route } = useRouter();
  const activeComp = route.comp;
  const now = Date.now();

  // 1. Resolve Live Streams
  const liveMatches = useMemo(() => {
    return matches.filter((m) => {
      const isLive = m.status === 'live';
      const hasStream =
        watchableSlugs.has(m.slug) || liveStreamForMatch(m, streamIndex, now) !== null;
      return (isLive || hasStream) && m.status !== 'finished';
    });
  }, [matches, streamIndex, watchableSlugs, now]);

  // 2. Resolve Top Scorers / Leaders
  const compConfig = COMPETITIONS[activeComp];
  const { leaders } = useLeaders(compConfig?.leadersSource === 'pipeline' ? activeComp : null);

  const topLeaders = useMemo(() => {
    if (compConfig?.leadersSource === 'pipeline') {
      return leaders.slice(0, 3);
    }
    if (scorers && scorers.length > 0) {
      return scorers.slice(0, 3).map((s, i) => ({
        rank: i + 1,
        name: s.name,
        teamName: s.teamName,
        teamLogo: s.teamFlag,
        displayValue: String(s.goals),
        value: s.goals,
      }));
    }
    return [];
  }, [scorers, leaders, compConfig]);

  // Standing tabs/sections
  const [soccerGroupIndex, setSoccerGroupIndex] = useState(0);
  const [nbaConf, setNbaConf] = useState<'eastern' | 'western'>('eastern');

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* 1. Live Streams Section */}
      <div className="ds-glass p-4 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-chalkdim/60 uppercase px-1 flex items-center gap-2">
          <Tv className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span>{t('live.streams') || 'Live Streams'}</span>
        </h3>
        {liveMatches.length === 0 ? (
          <p className="text-xs text-chalkdim/60 px-1 py-2 italic">
            {t('live.noStreams') || 'No live matches streaming right now.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {liveMatches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => navigate(pathFor({ kind: 'match', comp: activeComp, slug: m.slug }))}
                className="flex flex-col gap-1.5 p-2 rounded-card bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-left transition-all duration-200"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-mono uppercase bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded-micro font-bold">
                    {m.status === 'live' ? m.progress?.displayClock || 'LIVE' : 'STREAM LIVE'}
                  </span>
                  {m.progress?.displayClock === 'HT' && (
                    <span className="text-[10px] font-mono text-chalkdim/60">HT</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs w-full">
                  <div className="flex flex-col gap-0.5 font-medium text-chalk max-w-[70%] truncate">
                    <span className="truncate">{m.homeName}</span>
                    <span className="truncate">{m.awayName}</span>
                  </div>
                  {m.homeScore !== null && m.awayScore !== null && (
                    <div className="flex flex-col items-end font-bold font-mono text-chalk">
                      <span>{m.homeScore}</span>
                      <span>{m.awayScore}</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Standings Preview */}
      <div className="ds-glass p-4 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-chalkdim/60 uppercase px-1 flex items-center gap-2">
          <ListOrdered className="w-3.5 h-3.5" />
          <span>{t('fixtures.standings') || 'Standings'}</span>
        </h3>

        {standings.kind === 'soccer' && standings.groups.length > 0 && (
          <div className="flex flex-col gap-2">
            {standings.groups.length > 1 && (
              <div className="flex gap-1 overflow-x-auto no-scrollbar py-0.5 border-b border-white/5 mb-1">
                {standings.groups.slice(0, 4).map((g, idx) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => setSoccerGroupIndex(idx)}
                    className={`px-2 py-0.5 rounded-micro text-[10px] font-mono uppercase transition-all ${
                      soccerGroupIndex === idx
                        ? 'bg-white/10 text-chalk font-bold'
                        : 'text-chalkdim/60 hover:text-chalk'
                    }`}
                  >
                    {g.name.replace('Group ', '')}
                  </button>
                ))}
              </div>
            )}

            {/* Soccer Table */}
            <div className="flex flex-col gap-1.5">
              {(standings.groups[soccerGroupIndex] || standings.groups[0]).standings
                .slice(0, 5)
                .map((row, idx) => (
                  <div
                    key={row.teamId}
                    className="flex items-center justify-between text-xs py-0.5 px-1 rounded-micro hover:bg-white/5"
                  >
                    <div className="flex items-center gap-2 max-w-[70%] truncate">
                      <span className="font-mono text-chalkdim/50 w-3">{idx + 1}</span>
                      {row.flag && (
                        <img
                          src={row.flag}
                          alt=""
                          className="w-4 h-3.5 object-cover rounded-micro border border-white/10"
                          loading="lazy"
                        />
                      )}
                      <span className="font-medium text-chalk truncate">{row.name}</span>
                    </div>
                    <span className="font-mono font-bold text-chalk">{row.pts} PTS</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {standings.kind === 'basketball' && standings.conferences.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1 border-b border-white/5 mb-1 pb-1">
              {standings.conferences.map((conf) => {
                const confKey = conf.name.toLowerCase().includes('east') ? 'eastern' : 'western';
                return (
                  <button
                    key={conf.name}
                    type="button"
                    onClick={() => setNbaConf(confKey)}
                    className={`flex-1 text-center py-0.5 rounded-micro text-[10px] font-mono uppercase transition-all ${
                      nbaConf === confKey
                        ? 'bg-white/10 text-chalk font-bold'
                        : 'text-chalkdim/60 hover:text-chalk'
                    }`}
                  >
                    {conf.name.replace(' Conference', '')}
                  </button>
                );
              })}
            </div>

            {/* Basketball Table */}
            <div className="flex flex-col gap-1.5">
              {(
                standings.conferences.find((c) =>
                  nbaConf === 'eastern'
                    ? c.name.toLowerCase().includes('east')
                    : c.name.toLowerCase().includes('west'),
                ) || standings.conferences[0]
              ).rows
                .slice(0, 5)
                .map((row, idx) => (
                  <div
                    key={row.teamId}
                    className="flex items-center justify-between text-xs py-0.5 px-1 rounded-micro hover:bg-white/5"
                  >
                    <div className="flex items-center gap-2 max-w-[75%] truncate">
                      <span className="font-mono text-chalkdim/50 w-3">{idx + 1}</span>
                      {row.logo && (
                        <img
                          src={row.logo}
                          alt=""
                          className="w-4 h-4 object-contain"
                          loading="lazy"
                        />
                      )}
                      <span className="font-medium text-chalk truncate">{row.name}</span>
                    </div>
                    <span className="font-mono text-chalkdim/80">
                      {row.w}-{row.l}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Leaders Section */}
      {topLeaders.length > 0 && (
        <div className="ds-glass p-4 flex flex-col gap-3">
          <h3 className="text-xs font-mono tracking-widest text-chalkdim/60 uppercase px-1 flex items-center gap-2">
            <Award className="w-3.5 h-3.5" />
            <span>
              {COMPETITIONS[activeComp]?.sport === 'basketball'
                ? t('leaders.title') || 'Leaders'
                : t('scorers.title') || 'Top Scorers'}
            </span>
          </h3>
          <div className="flex flex-col gap-2.5">
            {topLeaders.map((l) => (
              <div key={l.name} className="flex items-center justify-between text-xs px-1">
                <div className="flex items-center gap-2.5 max-w-[75%]">
                  <span className="font-mono text-chalkdim/50 w-3">{l.rank}</span>
                  <div className="flex flex-col">
                    <span className="font-bold text-chalk truncate">{l.name}</span>
                    <span className="text-[10px] text-chalkdim/60">{l.teamName}</span>
                  </div>
                </div>
                <span className="font-mono font-bold text-chalk">{l.displayValue}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
