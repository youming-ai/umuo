import { Fragment } from 'react';
import { type ResolvedBracketMatch, type ResolvedTeam, useBracket } from '../hooks/useBracket';
import { useT } from '../i18n';
import type { CompMatch, WCGroup } from '../types';
import { navigate, pathFor, useRouter } from '../utils/router';

// Visual (top-to-bottom) ordering of match indices within each round, so the
// tree lines connect adjacent cells. Each round's list is split down the
// middle: the FIRST half feeds the LEFT side of the final, the SECOND half the
// RIGHT side — exactly what the symmetric layout below needs.
const VISUAL_ORDERS: Record<string, number[]> = {
  R32: [1, 6, 0, 2, 10, 11, 8, 9, 3, 5, 4, 7, 13, 15, 12, 14],
  R16: [16, 17, 20, 21, 18, 19, 22, 23],
  QF: [24, 25, 26, 27],
  SF: [28, 29],
  Final: [31],
};

const firstHalf = (o: number[]) => o.slice(0, o.length / 2);
const secondHalf = (o: number[]) => o.slice(o.length / 2);

type Round = 'R32' | 'R16' | 'QF' | 'SF' | 'Final';
interface Col {
  key: string;
  round: Round;
  indices: number[]; // SEEDING indices, already in top-to-bottom visual order
}

// Columns left→right: left half flows rightward into the central Final, then
// the right half mirrors it back out. The Final sits in the middle.
const COLUMNS: Col[] = [
  { key: 'R32L', round: 'R32', indices: firstHalf(VISUAL_ORDERS.R32) },
  { key: 'R16L', round: 'R16', indices: firstHalf(VISUAL_ORDERS.R16) },
  { key: 'QFL', round: 'QF', indices: firstHalf(VISUAL_ORDERS.QF) },
  { key: 'SFL', round: 'SF', indices: firstHalf(VISUAL_ORDERS.SF) },
  { key: 'Final', round: 'Final', indices: VISUAL_ORDERS.Final },
  { key: 'SFR', round: 'SF', indices: secondHalf(VISUAL_ORDERS.SF) },
  { key: 'QFR', round: 'QF', indices: secondHalf(VISUAL_ORDERS.QF) },
  { key: 'R16R', round: 'R16', indices: secondHalf(VISUAL_ORDERS.R16) },
  { key: 'R32R', round: 'R32', indices: secondHalf(VISUAL_ORDERS.R32) },
];

// SVG lines between two adjacent columns. Different sizes = a merge (two
// parents → one child); the bigger side holds the parents, so the right-flowing
// half is drawn mirrored. Equal sizes (SF ↔ Final) = one straight line.
function Connector({ leftCount, rightCount }: { leftCount: number; rightCount: number }) {
  const cls = 'w-3 h-full shrink-0 stroke-line/30 py-2';
  if (leftCount === rightCount) {
    return (
      <svg
        className={cls}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M 0 50 H 100" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const parentCount = Math.max(leftCount, rightCount);
  const childCount = parentCount / 2;
  const paths = [];
  for (let i = 0; i < childCount; i++) {
    const yParent1 = ((2 * i + 0.5) / parentCount) * 100;
    const yParent2 = ((2 * i + 1.5) / parentCount) * 100;
    const yChild = ((i + 0.5) / childCount) * 100;
    paths.push(
      <path
        key={i}
        d={`M 0 ${yParent1} H 50 V ${yParent2} H 0 M 50 ${yChild} H 100`}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  return (
    // rightCount > leftCount → parents are on the RIGHT → flip horizontally.
    <svg
      className={cls}
      style={rightCount > leftCount ? { transform: 'scaleX(-1)' } : undefined}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

function Column({
  col,
  byIndex,
  comp,
  t,
}: {
  col: Col;
  byIndex: Map<number, ResolvedBracketMatch>;
  comp: string;
  t: (k: string) => string;
}) {
  const cells = col.indices.map((i) => byIndex.get(i)).filter(Boolean) as ResolvedBracketMatch[];
  return (
    <div className="flex flex-col justify-around h-full flex-1 min-w-0 py-1">
      {cells.map((m) => (
        <BracketCell key={m.index} match={m} comp={comp} t={t} />
      ))}
    </div>
  );
}

export default function BracketView({
  groups,
  matches,
}: {
  groups: WCGroup[];
  matches: CompMatch[];
}) {
  const t = useT();
  const { route } = useRouter();
  const comp = route.comp;
  const { resolved } = useBracket(groups, matches);
  const byIndex = new Map(resolved.map((m) => [m.index, m]));
  const finalMatch = byIndex.get(VISUAL_ORDERS.Final[0]!);
  const thirdPlace = resolved.find((m) => m.round === '3rd');

  return (
    // Fits the container width — no horizontal scroll. Columns flex to share
    // the width; connectors keep a fixed thin width. Each R32 side is only 8
    // cells tall, so the tree is far shorter than the old single-direction one.
    <div className="w-full">
      <div className="flex flex-col py-2">
        {/* Headings */}
        <div className="flex gap-0 items-center border-b border-line/20 pb-2 mb-2">
          {COLUMNS.map((col, idx) => (
            <Fragment key={col.key}>
              {idx > 0 && <div className="w-3 shrink-0" />}
              <h3 className="flex-1 min-w-0 text-center ds-caption uppercase tracking-[0.14em] text-chalkdim">
                {t(`bracket.${col.round}`)}
              </h3>
            </Fragment>
          ))}
        </div>

        {/* Tree: left half → central Final (+ 3rd place) ← right half */}
        <div className="flex gap-0 items-stretch h-[640px] relative">
          {COLUMNS.map((col, idx) => (
            <Fragment key={col.key}>
              {idx > 0 && (
                <Connector
                  leftCount={COLUMNS[idx - 1].indices.length}
                  rightCount={col.indices.length}
                />
              )}
              {col.key === 'Final' ? (
                // Final sits at the exact vertical center so the SF↔Final
                // straight connectors land on it; the 3rd-place cell hangs
                // directly below it (absolute, out of flow, so it doesn't
                // push the Final off-center).
                <div className="flex flex-col justify-center items-center h-full flex-1 min-w-0 py-1">
                  <div className="relative w-full">
                    {finalMatch && <BracketCell match={finalMatch} comp={comp} t={t} />}
                    {thirdPlace && (
                      <div className="absolute top-full inset-x-0 mt-4">
                        <h3 className="ds-caption uppercase tracking-[0.18em] text-chalkdim/70 mb-1 text-center">
                          {t('bracket.3rd')}
                        </h3>
                        <BracketCell match={thirdPlace} comp={comp} t={t} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <Column col={col} byIndex={byIndex} comp={comp} t={t} />
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function BracketCell({
  match,
  comp,
  t,
}: {
  match: ResolvedBracketMatch;
  comp: string;
  t: (k: string) => string;
}) {
  const onClick = () => {
    if (match.match) {
      navigate(pathFor({ kind: 'match', comp, slug: match.match.slug }));
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!match.match}
      className="w-full rounded-card border border-line bg-panel px-1.5 py-1 text-left transition-all duration-200 hover:border-pitch focus:outline-none disabled:cursor-default disabled:hover:border-line shadow-panel"
    >
      <div className="flex items-center justify-between ds-caption text-chalkdim/60 mb-0.5">
        <span>{match.label}</span>
        {match.match && match.match.status === 'finished' && <span className="text-pitch">FT</span>}
        {match.match && match.match.status === 'live' && <span className="text-live">LIVE</span>}
      </div>
      <div className="flex items-center justify-between my-0.5 w-full min-w-0">
        <div
          className={`flex items-center gap-1 font-display text-[11px] min-w-0 truncate ${
            match.winner === 'home' ? 'text-chalk font-bold' : 'text-chalk'
          }`}
        >
          {match.home ? <TeamLabel team={match.home} /> : <TBD t={t} />}
        </div>
        {match.match && match.match.homeScore != null && (
          <span
            className={`text-[11px] tabular-nums shrink-0 ml-1.5 ${match.winner === 'home' ? 'text-chalk font-bold' : 'text-chalkdim'}`}
          >
            {match.match.homeScore}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between w-full min-w-0">
        <div
          className={`flex items-center gap-1 font-display text-[11px] min-w-0 truncate ${
            match.winner === 'away' ? 'text-chalk font-bold' : 'text-chalk'
          }`}
        >
          {match.away ? <TeamLabel team={match.away} /> : <TBD t={t} />}
        </div>
        {match.match && match.match.awayScore != null && (
          <span
            className={`text-[11px] tabular-nums shrink-0 ml-1.5 ${match.winner === 'away' ? 'text-chalk font-bold' : 'text-chalkdim'}`}
          >
            {match.match.awayScore}
          </span>
        )}
      </div>
    </button>
  );
}

function TeamLabel({ team }: { team: ResolvedTeam }) {
  return (
    <>
      {team.flag && (
        <img src={team.flag} alt="" className="w-3.5 h-2.5 object-cover rounded-micro shrink-0" />
      )}
      <span className="truncate">{team.label}</span>
    </>
  );
}

function TBD({ t }: { t: (k: string) => string }) {
  return <span className="text-chalkdim/40 ds-caption">{t('bracket.tbd')}</span>;
}
