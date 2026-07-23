import type { StandingsData } from '../adapters/types';
import { useMemo, useState } from 'react';
import { Award, ListOrdered } from 'lucide-react';
import { COMPETITIONS } from '../competitions';
import { useLeaders } from '../hooks/useLeaders';

interface RightRailProps {
  /** Authoritative competition for this rail (island prop, not router parse). */
  comp: string;
  standings: StandingsData;
  standingsLoading?: boolean;
  standingsError?: string | null;
  onStandingsRetry?: () => void;
}

export default function RightRail({
  comp: activeComp,
  standings,
  standingsLoading = false,
  standingsError = null,
  onStandingsRetry,
}: RightRailProps) {
  const compConfig = COMPETITIONS[activeComp];
  const usesPipeline = compConfig?.leadersSource === 'pipeline';
  const {
    leaders,
    loading: leadersLoading,
    error: leadersError,
    refetch,
  } = useLeaders(usesPipeline ? activeComp : null);

  const topLeaders = useMemo(() => leaders.slice(0, 3), [leaders]);

  const hasStandings =
    (standings.kind === 'soccer' && standings.groups.length > 0) ||
    (standings.kind === 'basketball' && standings.conferences.length > 0);

  const [soccerGroupIndex, setSoccerGroupIndex] = useState(0);
  const [nbaConf, setNbaConf] = useState<'eastern' | 'western'>('eastern');

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="ds-glass p-4 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-chalkdim uppercase px-1 flex items-center gap-2">
          <ListOrdered className="w-3.5 h-3.5" />
          <span>Standings</span>
        </h3>

        {standings.kind === 'soccer' && standings.groups.length > 0 && (
          <div className="flex flex-col gap-2">
            {standings.groups.length > 1 && (
              <div className="flex gap-1 overflow-x-auto no-scrollbar py-0.5 border-b border-line/25 mb-1">
                {standings.groups.map((g, idx) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => setSoccerGroupIndex(idx)}
                    className={`min-h-11 px-2 py-0.5 rounded-control text-caption font-mono uppercase ds-press ${
                      soccerGroupIndex === idx
                        ? 'bg-overlay/10 text-chalk font-bold'
                        : 'text-chalkdim hover:text-chalk'
                    }`}
                  >
                    {g.name.replace('Group ', '')}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {(standings.groups[soccerGroupIndex] || standings.groups[0]).standings
                .slice(0, 5)
                .map((row, idx) => (
                  <div
                    key={row.teamId}
                    className="flex items-center justify-between text-xs py-0.5 px-1 rounded-micro hover:bg-overlay/5"
                  >
                    <div className="flex items-center gap-2 max-w-[70%] truncate">
                      <span className="font-mono text-chalkdim w-3">{idx + 1}</span>
                      {row.flag && (
                        <img
                          src={row.flag}
                          alt=""
                          className="w-4 h-3.5 object-cover rounded-card-inset"
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
            <div className="flex gap-1 border-b border-line/25 mb-1 pb-1">
              {standings.conferences.map((conf) => {
                const confKey = conf.name.toLowerCase().includes('east') ? 'eastern' : 'western';
                return (
                  <button
                    key={conf.name}
                    type="button"
                    onClick={() => setNbaConf(confKey)}
                    className={`min-h-11 flex-1 text-center py-0.5 rounded-control text-caption font-mono uppercase ds-press ${
                      nbaConf === confKey
                        ? 'bg-overlay/10 text-chalk font-bold'
                        : 'text-chalkdim hover:text-chalk'
                    }`}
                  >
                    {conf.name.replace(' Conference', '')}
                  </button>
                );
              })}
            </div>

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
                    className="flex items-center justify-between text-xs py-0.5 px-1 rounded-micro hover:bg-overlay/5"
                  >
                    <div className="flex items-center gap-2 max-w-[75%] truncate">
                      <span className="font-mono text-chalkdim w-3">{idx + 1}</span>
                      {row.logo && (
                        <img
                          src={row.logo}
                          alt=""
                          className="w-4 h-4 object-contain rounded-card-inset"
                          loading="lazy"
                        />
                      )}
                      <span className="font-medium text-chalk truncate">{row.name}</span>
                    </div>
                    <span className="font-mono text-chalkdim">
                      {row.w}-{row.l}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {!hasStandings && standingsLoading ? (
          <p className="text-xs text-chalkdim px-1 py-2">Loading standings…</p>
        ) : !hasStandings && standingsError ? (
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <p className="text-xs text-live">{standingsError}</p>
            {onStandingsRetry && (
              <button
                type="button"
                onClick={onStandingsRetry}
                className="min-h-11 px-3 rounded-pill text-xs font-semibold text-pitch hover:bg-pitch/10 transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        ) : !hasStandings ? (
          <p className="text-xs text-chalkdim px-1 py-2">No standings yet.</p>
        ) : null}
      </div>

      {(usesPipeline || topLeaders.length > 0) && (
        <div className="ds-glass p-4 flex flex-col gap-3">
          <h3 className="text-xs font-mono tracking-widest text-chalkdim uppercase px-1 flex items-center gap-2">
            <Award className="w-3.5 h-3.5" />
            <span>
              {COMPETITIONS[activeComp]?.sport === 'basketball' ? 'Scoring Leaders' : 'Top Scorers'}
            </span>
          </h3>
          {leadersLoading && topLeaders.length === 0 ? (
            <p className="text-xs text-chalkdim px-1 py-2">Loading leaders…</p>
          ) : leadersError && topLeaders.length === 0 ? (
            <div className="flex items-center justify-between gap-2 px-1 py-1">
              <p className="text-xs text-live">{leadersError}</p>
              <button
                type="button"
                onClick={refetch}
                className="min-h-11 px-3 rounded-pill text-xs font-semibold text-pitch hover:bg-pitch/10 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : topLeaders.length === 0 ? (
            <p className="text-xs text-chalkdim px-1 py-2">No leaders yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {topLeaders.map((l) => (
                <div key={l.name} className="flex items-center justify-between text-xs px-1">
                  <div className="flex items-center gap-2.5 max-w-[75%]">
                    <span className="font-mono text-chalkdim w-3">{l.rank}</span>
                    <div className="flex flex-col">
                      <span className="font-bold text-chalk truncate">{l.name}</span>
                      <span className="text-caption text-chalkdim">{l.teamName}</span>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-chalk">{l.displayValue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
