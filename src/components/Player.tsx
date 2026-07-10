import { useEffect, useMemo, useState } from 'react';
import type { Match } from '../types';
import { isTrustedStreamUrl } from '../utils/streamSources';

interface PlayerProps {
  match: Match | null;
  selectedIframeUrl: string;
  setSelectedIframeUrl: (url: string) => void;
}

function CornerTicks() {
  const base = 'absolute w-4 h-4 border-pitch/70 pointer-events-none z-10';
  return (
    <>
      <span className={`${base} top-2 left-2 border-t-2 border-l-2`} />
      <span className={`${base} top-2 right-2 border-t-2 border-r-2`} />
      <span className={`${base} bottom-2 left-2 border-b-2 border-l-2`} />
      <span className={`${base} bottom-2 right-2 border-b-2 border-r-2`} />
    </>
  );
}

// ppv.to feeds carry only a language code (not a country), so a flag would be a
// guess — show the broadcaster tag + a quality badge for 4K/UHD feeds instead.
function qualityBadge(label: string): string | null {
  return /\b4k\b/i.test(label) || /\buhd\b/i.test(label) ? '4K' : null;
}

// Derive a coarse live-state for the player overlay from the match's
// `alwaysLive` flag + kickoff window. The feed only carries a 2-state status,
// so HT/FT detection here is best-effort:
//   - alwaysLive matches are treated as `live`
//   - now past endsAt = `finished`; before startsAt = `upcoming`
//   - 35-60min into a non-alwaysLive window = likely HT (heuristic)
// The detailed HT/FT state for ESPN-backed matches lives on `CompMatch.progress`
// (MatchCard); this overlay is intentionally simpler.
function playerStatus(match: Match): 'live' | 'ht' | 'finished' | 'upcoming' {
  if (match.alwaysLive) return 'live';
  const now = Math.floor(Date.now() / 1000);
  if (match.endsAt && now > match.endsAt) return 'finished';
  if (match.startsAt && now < match.startsAt) return 'upcoming';
  // ponytail: HT heuristic — 35-60min after kickoff is the likely break window
  if (match.startsAt) {
    const minutesIn = (now - match.startsAt) / 60;
    if (minutesIn >= 35 && minutesIn <= 60) return 'ht';
  }
  return 'live';
}

// Top-left status badge over the iframe. Mirrors MatchCard's status pill but
// tuned for the dark video background: live → red pulse, ht → amber, finished
// / upcoming → muted.
function PlayerStatusBadge({ status }: { status: 'live' | 'ht' | 'finished' | 'upcoming' }) {
  if (status === 'ht') {
    return (
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-0.5 ds-scrim-badge border border-amber/30 shadow-[0_0_10px_rgb(var(--c-amber)_/_0.15)] select-none">
        <span className="font-mono text-xs tracking-widest text-amber font-bold">Half-time</span>
      </div>
    );
  }
  if (status === 'live') {
    return (
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-0.5 ds-scrim-badge border border-live/30 shadow-[0_0_10px_rgb(var(--c-live)_/_0.15)] select-none">
        <span className="live-dot" />
        <span className="font-mono text-xs tracking-widest text-live font-bold">LIVE</span>
      </div>
    );
  }
  if (status === 'finished') {
    return (
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-0.5 ds-scrim-badge border border-overlay/10 select-none">
        <span className="font-mono text-xs tracking-widest text-onscrim/70 font-bold">Final</span>
      </div>
    );
  }
  return (
    <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-0.5 ds-scrim-badge border border-overlay/10 select-none">
      <span className="font-mono text-xs tracking-widest text-onscrim/60 font-bold">Upcoming</span>
    </div>
  );
}

export default function Player({ match, selectedIframeUrl, setSelectedIframeUrl }: PlayerProps) {
  const sources = useMemo(() => {
    if (!match) return [];
    const raw = [
      { iframe: match.iframe, label: match.sourceTag || 'Feed' },
      ...(match.substreams ?? []).map((s) => ({ iframe: s.iframe, label: s.source_tag || s.name })),
    ];
    return raw
      .filter((src) => isTrustedStreamUrl(src.iframe))
      .filter((src, index, all) => all.findIndex((item) => item.iframe === src.iframe) === index);
  }, [match]);
  const activeIframeUrl = sources.some((src) => src.iframe === selectedIframeUrl)
    ? selectedIframeUrl
    : '';

  // 切换线路 / 进入直播时，iframe 重新加载 —— 在其 onLoad 前盖一层信号接入动画
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
  }, []);
  useEffect(() => {
    if (!match) return;
    const fallback = sources[0]?.iframe ?? '';
    if (selectedIframeUrl !== fallback && !activeIframeUrl) {
      setSelectedIframeUrl(fallback);
    }
  }, [activeIframeUrl, match, selectedIframeUrl, setSelectedIframeUrl, sources]);

  if (!match) {
    return (
      <div className="relative h-full min-h-[60vh] ds-glass-hero overflow-hidden flex items-center justify-center">
        <CornerTicks />
        <div className="text-center px-8">
          <div className="font-mono text-xs tracking-[0.3em] text-pitch mb-4">STANDBY</div>
          <h2 className="font-display font-bold text-3xl text-chalk tracking-wide mb-3">
            Awaiting signal
          </h2>
          <p className="font-body text-sm text-chalkdim max-w-sm mx-auto leading-relaxed">
            Pick a match from the list to start watching.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-card">
      <div className="relative aspect-video w-full rounded-panel border border-line/30 bg-black overflow-hidden shadow-hero">
        <CornerTicks />
        <PlayerStatusBadge status={playerStatus(match)} />

        {activeIframeUrl && (
          <iframe
            key={activeIframeUrl}
            src={activeIframeUrl}
            title={match.name}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            onLoad={() => setLoading(false)}
            className="absolute inset-0 w-full h-full"
          />
        )}

        {activeIframeUrl && loading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black"
            aria-live="polite"
          >
            <span className="live-dot" />
            <span className="font-mono text-xs tracking-[0.3em] text-pitch animate-pulse motion-reduce:animate-none">
              Loading…
            </span>
          </div>
        )}

        {!activeIframeUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-chalkdim">
              Signal unavailable
            </span>
            <p className="max-w-sm text-sm text-chalk">
              No trusted stream source is currently available for this match.
            </p>
          </div>
        )}
      </div>

      <div className="ds-glass-hero p-card space-y-card">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="ds-caption uppercase tracking-[0.2em] text-chalkdim">
              {match.category_name}
            </span>
            <span className="ds-caption text-pitch flex items-center gap-1">
              <span className="w-1 h-1 bg-pitch" />
              {match.viewers} watching
            </span>
          </div>
          <h1 className="font-display font-bold text-2xl md:text-3xl text-chalk tracking-wide">
            {match.name}
          </h1>
        </div>

        <div>
          <p className="ds-caption uppercase tracking-[0.25em] text-chalkdim mb-2">
            Available sources
          </p>
          <div className="flex flex-wrap gap-2">
            {sources.map((src) => {
              const active = activeIframeUrl === src.iframe;
              const q = qualityBadge(src.label);
              return (
                <button
                  // iframe URL is unique per source, so it's a stable key on
                  // its own — array index would only matter if the same URL
                  // could appear twice in `sources`, which the dedupe above
                  // already prevents.
                  key={src.iframe}
                  type="button"
                  onClick={() => setSelectedIframeUrl(src.iframe)}
                  aria-pressed={active}
                  className={`inline-flex min-h-11 items-center gap-2 px-4 py-1.5 rounded-pill border text-sm transition-all duration-200 ${
                    active
                      ? 'bg-pitch text-onaccent border-pitch font-bold shadow-sm'
                      : 'border-line bg-panel2 text-chalkdim hover:text-chalk hover:bg-panel'
                  }`}
                >
                  <span className="truncate max-w-[14rem]">{src.label}</span>
                  {q && (
                    <span
                      className={`px-1.5 py-0.5 ds-micro font-bold tracking-wide rounded-micro ${
                        active ? 'bg-scrim/20 text-onaccent' : 'bg-pitch/15 text-pitch'
                      }`}
                    >
                      {q}
                    </span>
                  )}
                </button>
              );
            })}
            {sources.length === 0 && (
              <span className="text-sm text-chalkdim">No sources available.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
