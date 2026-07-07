import { useT } from '../i18n';
import type { CompMatch } from '../types';
import { marqueeMatches } from '../utils/marquee';
import { navigate, pathFor } from '../utils/router';

export default function MarqueeScoreboard({
  matches,
  comp,
}: {
  matches: CompMatch[];
  comp: string;
}) {
  const items = marqueeMatches(matches, Date.now());
  if (items.length === 0) return null;

  // Duplicate the row so the CSS translateX(-50%) loop is seamless. The track
  // auto-scrolls (paused on hover, disabled under reduced-motion via index.css)
  // inside an overflow-x-auto rail that stays manually scrollable regardless.
  const row = [...items, ...items];

  return (
    <div className="border-b border-line/20 bg-night overflow-x-auto no-scrollbar">
      <div className="marquee-track flex w-max gap-2 px-page-x md:px-page-x-md py-2">
        {row.map((match, i) => (
          <Chip
            key={`${match.id}-${i < items.length ? 'first' : 'copy'}`}
            match={match}
            comp={comp}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({ match, comp }: { match: CompMatch; comp: string }) {
  const t = useT();
  const onClick = () => navigate(pathFor({ kind: 'match', comp, slug: match.slug }));
  const time = match.kickoff?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
  const statusLabel =
    match.status === 'live'
      ? t('status.live')
      : match.status === 'finished'
        ? t('status.ft')
        : time;
  const statusCls =
    match.status === 'live'
      ? 'text-live'
      : match.status === 'finished'
        ? 'text-pitch'
        : 'text-chalkdim';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${match.homeName} v ${match.awayName}`}
      className="shrink-0 w-40 rounded-card border border-line bg-panel px-2 py-1 text-left transition-colors hover:border-pitch focus:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
    >
      <div className={`ds-caption mb-0.5 ${statusCls}`}>{statusLabel}</div>
      <TeamLine flag={match.homeFlag} name={match.homeName} score={match.homeScore} />
      <TeamLine flag={match.awayFlag} name={match.awayName} score={match.awayScore} />
    </button>
  );
}

function TeamLine({ flag, name, score }: { flag: string; name: string; score: number | null }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {flag ? (
        <img src={flag} alt={name} className="w-5 h-3.5 object-cover rounded-micro shrink-0" />
      ) : (
        <span className="w-5 h-3.5 shrink-0" />
      )}
      <span className="flex-1 min-w-0 truncate font-display text-[11px] text-chalk">{name}</span>
      {score != null && (
        <span className="ml-1 text-[11px] tabular-nums text-chalk shrink-0">{score}</span>
      )}
    </div>
  );
}
