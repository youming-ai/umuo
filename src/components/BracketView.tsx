import { type ResolvedBracketMatch, type ResolvedTeam, useBracket } from '../hooks/useBracket';
import { useT } from '../i18n';
import type { CompMatch, WCGroup } from '../types';
import { pathFor, useRouter } from '../utils/router';

// Radial bracket. The knockout is a balanced binary tree, so we draw it as
// concentric rings collapsing toward the trophy at the centre: 32 nations on
// the rim (leaves), then one ring per round spiralling inward. The tree's two
// halves fill the left and right semicircles, so the finalists land at 9 and 3
// o'clock, flanking the cup. A team's run lights up in its own colour and grows
// bolder the deeper it goes; eliminated nations fade to grey on the rim.

// R32 matches, top-to-bottom visual order. First 8 feed the LEFT half of the
// draw, last 8 the RIGHT half — the ordering keeps sibling matches adjacent so
// every merge toward the centre stays untangled (same list the old tree used).
const R32_ORDER = [1, 4, 0, 2, 10, 11, 8, 9, 3, 5, 6, 7, 13, 15, 12, 14];
const SF_LEFT = 28;
const SF_RIGHT = 29;

const BOX = 1000;
const C = BOX / 2;
const GAP = 12; // degrees of empty sky at top & bottom, splitting the two halves
const STEP = (180 - 2 * GAP) / 16; // 16 leaves per semicircle
const EDGE = 496; // where the decorative rays die out
const HALO = 78; // gold ring radius, just inside the finalists

// Ring radii (distance from centre) and crest diameters, outermost first.
const RING = { leaf: 452, R32: 362, R16: 272, QF: 182, SF: 100 } as const;
const SIZE = { leaf: 82, R32: 46, R16: 54, QF: 62, SF: 96 } as const;

// Line weight / brightness by how deep a round sits (R32→Final). Outer rounds
// stay thin so deep runs read as the loud element.
const DEPTH: Record<string, number> = { R32: 0, R16: 1, QF: 2, SF: 3, Final: 4 };
const WIN_W = [2.6, 3.4, 4.4, 5.6, 6.4];
const WIN_O = [0.5, 0.68, 0.86, 1, 1];

// ponytail: contained decorative palette for winner-path lines — not semantic
// tokens. Each is legible on both light and dark; a nation's id hashes into it
// so its run keeps one hue from rim to cup (red repeats, exactly like the poster).
const PATH_RGB = ['37 99 235', '220 38 38', '13 148 136', '124 58 237', '234 88 12', '5 150 105'];
const colorOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PATH_RGB[h % PATH_RGB.length]!;
};

type Pt = { x: number; y: number };
// angle measured clockwise from 12 o'clock, so top=0°, east=90°, west=270°.
const pt = (deg: number, r: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

// Angle of every leaf and every match node, computed once. Leaves are spread
// evenly across each semicircle; a match node sits at the mean of its two
// children's angles, which is why the two finalists resolve to 270°/90°.
function computeAngles() {
  const leafA = new Map<string, number>(); // `${matchIndex}:${'home'|'away'}` → deg
  R32_ORDER.forEach((mi, p) => {
    const i = p % 8; // position within this half (0..7)
    // Right half (p 8..15) sweeps top→bottom down the east side; left half
    // (p 0..7) sweeps top→bottom down the west side.
    const base = p < 8 ? 360 - GAP - STEP * (2 * i + 0.5) : GAP + STEP * (2 * i + 0.5);
    // home sits one step "above" (nearer 12 o'clock) its away partner.
    leafA.set(`${mi}:home`, base);
    leafA.set(`${mi}:away`, p < 8 ? base - STEP : base + STEP);
  });

  const nodeA = new Map<number, number>();
  for (const mi of R32_ORDER) {
    nodeA.set(mi, (leafA.get(`${mi}:home`)! + leafA.get(`${mi}:away`)!) / 2);
  }
  // Inner rounds: each node is the midpoint of its two child match nodes. The
  // pairings mirror the seeding tree; both halves converge to their finalist.
  const merge = (parent: number, a: number, b: number) =>
    nodeA.set(parent, (nodeA.get(a)! + nodeA.get(b)!) / 2);
  merge(16, 1, 4);
  merge(17, 0, 2);
  merge(18, 3, 5);
  merge(19, 6, 7);
  merge(20, 10, 11);
  merge(21, 8, 9);
  merge(22, 13, 15);
  merge(23, 12, 14);
  merge(24, 16, 17);
  merge(25, 20, 21);
  merge(26, 18, 19);
  merge(27, 22, 23);
  merge(SF_LEFT, 24, 25);
  merge(SF_RIGHT, 26, 27);
  return { leafA, nodeA };
}

const { leafA, nodeA } = computeAngles();

// Which ring a match's winner node lives on.
const ROUND_RING: Record<string, keyof typeof RING> = { R16: 'R16', QF: 'QF', SF: 'SF' };

// Child match index feeding one side of an inner-round node, read from the
// seeding tree (home/away winner slots). QF 24 ← R16 16, etc.
const CHILDREN: Record<number, [number, number]> = {
  16: [1, 4],
  17: [0, 2],
  18: [3, 5],
  19: [6, 7],
  20: [10, 11],
  21: [8, 9],
  22: [13, 15],
  23: [12, 14],
  24: [16, 17],
  25: [20, 21],
  26: [18, 19],
  27: [22, 23],
  28: [24, 25],
  29: [26, 27],
};

interface Edge {
  d: string;
  win: boolean;
  depth: number;
  rgb: string | null;
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
  const thirdPlace = resolved.find((m) => m.round === '3rd');

  const nodeRadius = (m: ResolvedBracketMatch) =>
    m.round === 'Final' ? 0 : m.round === 'R32' ? RING.R32 : RING[ROUND_RING[m.round]!];
  const nodeAngle = (m: ResolvedBracketMatch) => nodeA.get(m.index) ?? 0;

  // A child→parent edge as a dogleg: radially inward along the child's spoke to
  // the parent's ring, then a short chord across to the parent node.
  const dogleg = (childAng: number, childR: number, parentAng: number, parentR: number) => {
    const c = pt(childAng, childR);
    const bend = pt(childAng, parentR);
    const p = pt(parentAng, parentR);
    return `M ${c.x.toFixed(1)} ${c.y.toFixed(1)} L ${bend.x.toFixed(1)} ${bend.y.toFixed(1)} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  };

  // Every edge, tagged with whether it carried the winner (→ coloured) and how
  // deep it sits (→ weight). Coloured by the advancing nation.
  const edges: Edge[] = [];
  for (const m of resolved) {
    if (m.round === '3rd') continue;
    const pR = nodeRadius(m);
    const pA = m.round === 'Final' ? 0 : nodeAngle(m);
    const depth = DEPTH[m.round]!;
    const push = (childAng: number, childR: number, side: 'home' | 'away') => {
      const win = m.winner === side;
      const team = side === 'home' ? m.home : m.away;
      edges.push({
        d: dogleg(childAng, childR, pA, pR),
        win,
        depth,
        rgb: team ? colorOf(team.teamId) : null,
      });
    };
    if (m.round === 'R32') {
      push(leafA.get(`${m.index}:home`)!, RING.leaf, 'home');
      push(leafA.get(`${m.index}:away`)!, RING.leaf, 'away');
    } else {
      const [hc, ac] = m.round === 'Final' ? [SF_LEFT, SF_RIGHT] : CHILDREN[m.index]!;
      push(nodeA.get(hc)!, nodeRadius(byIndex.get(hc)!), 'home');
      push(nodeA.get(ac)!, nodeRadius(byIndex.get(ac)!), 'away');
    }
  }

  const leafAngles = [...leafA.values()];

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div className="relative w-full max-w-[700px] aspect-square mx-auto">
        <svg
          viewBox={`0 0 ${BOX} ${BOX}`}
          className="w-full h-full overflow-visible"
          role="img"
          aria-label={t('bracket.Final')}
        >
          <defs>
            <radialGradient id="cupGlow">
              <stop offset="0%" stopColor="rgb(var(--c-amber))" stopOpacity="0.55" />
              <stop offset="45%" stopColor="rgb(var(--c-amber))" stopOpacity="0.13" />
              <stop offset="100%" stopColor="rgb(var(--c-amber))" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* decorative sunburst: one faint ray out through each nation */}
          {leafAngles.map((a) => {
            const i = pt(a, HALO + 30);
            const o = pt(a, EDGE);
            return (
              <line
                key={`ray${a.toFixed(2)}`}
                x1={i.x}
                y1={i.y}
                x2={o.x}
                y2={o.y}
                className="stroke-line/15"
                strokeWidth={1}
              />
            );
          })}

          {/* dormant edges, then coloured winning edges on top */}
          {edges
            .filter((e) => !e.win)
            .map((e) => (
              <path
                key={`d${e.d}`}
                d={e.d}
                fill="none"
                className="stroke-line/25"
                strokeWidth={1.5}
              />
            ))}
          {edges
            .filter((e) => e.win && e.rgb)
            .map((e) => (
              <path
                key={`w${e.d}`}
                d={e.d}
                fill="none"
                pathLength={1}
                className="bracket-spark"
                stroke={`rgb(${e.rgb})`}
                strokeOpacity={WIN_O[e.depth]}
                strokeWidth={WIN_W[e.depth]}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

          {/* trophy glow, solid halo ring + cardinal nodes */}
          <circle cx={C} cy={C} r={190} fill="url(#cupGlow)" />
          <circle
            cx={C}
            cy={C}
            r={HALO}
            fill="none"
            className="stroke-amber/55"
            strokeWidth={1.5}
          />
          {[0, 90, 180, 270].map((a) => {
            const q = pt(a, HALO);
            return <circle key={`h${a}`} cx={q.x} cy={q.y} r={4.5} className="fill-amber" />;
          })}

          {/* leaves: the 32 seeded nations on the rim */}
          {R32_ORDER.flatMap((mi) => {
            const m = byIndex.get(mi)!;
            return (['home', 'away'] as const).map((side) => (
              <Node
                key={`${mi}:${side}`}
                center={pt(leafA.get(`${mi}:${side}`)!, RING.leaf)}
                size={SIZE.leaf}
                team={m[side]}
                match={m.match}
                comp={comp}
                eliminated={m.winner != null && m.winner !== side}
                t={t}
              />
            ));
          })}

          {/* winner nodes per inner round + the finalists */}
          {resolved
            .filter(
              (m) => m.round === 'R32' || m.round === 'R16' || m.round === 'QF' || m.round === 'SF',
            )
            .map((m) => (
              <Node
                key={`n${m.index}`}
                center={pt(nodeAngle(m), nodeRadius(m))}
                size={SIZE[m.round === 'R32' ? 'R32' : ROUND_RING[m.round]!]}
                team={winnerTeam(m)}
                match={m.match}
                comp={comp}
                t={t}
              />
            ))}

          {/* the cup */}
          <text x={C} y={C} textAnchor="middle" dominantBaseline="central" fontSize={150}>
            🏆
          </text>
        </svg>
      </div>

      {/* rings, named outward-in */}
      <p className="ds-caption uppercase tracking-[0.16em] text-chalkdim/60 text-center">
        {[
          t('bracket.R32'),
          t('bracket.R16'),
          t('bracket.QF'),
          t('bracket.SF'),
          t('bracket.Final'),
        ].join(' · ')}
      </p>

      {thirdPlace && <ThirdPlaceChip match={thirdPlace} comp={comp} t={t} />}
    </div>
  );
}

// Resolved winner team of a match (null while undecided).
function winnerTeam(m: ResolvedBracketMatch): ResolvedTeam | null {
  if (m.winner === 'home') return m.home;
  if (m.winner === 'away') return m.away;
  return null;
}

// A clickable crest disc. Renders the flag clipped to a circle, or a grey disc
// for a TBD / undecided slot. Eliminated leaves desaturate so the advancing
// nation stands out on the rim.
function Node({
  center,
  size,
  team,
  match,
  comp,
  eliminated,
  t,
}: {
  center: Pt;
  size: number;
  team: ResolvedTeam | null;
  match: CompMatch | null;
  comp: string;
  eliminated?: boolean;
  t: (k: string) => string;
}) {
  const r = size / 2;
  const href = match ? pathFor({ kind: 'match', comp, slug: match.slug }) : undefined;
  const label = team ? team.label : t('bracket.tbd');
  // Undecided / not-yet-qualified slot: a quiet waypoint dot, not a full disc,
  // so only real crests carry visual weight on the disc.
  if (!team) {
    return <circle cx={center.x} cy={center.y} r={r * 0.42} className="fill-panel2/70" />;
  }
  const disc = (
    <>
      {team.flag ? (
        <image
          href={team.flag}
          x={center.x - r}
          y={center.y - r}
          width={size}
          height={size}
          preserveAspectRatio="xMidYMid slice"
          style={{
            clipPath: 'circle(50%)',
            filter: eliminated ? 'grayscale(1) brightness(0.7)' : undefined,
          }}
        />
      ) : (
        <circle cx={center.x} cy={center.y} r={r} className="fill-panel2" />
      )}
      <circle
        cx={center.x}
        cy={center.y}
        r={r}
        fill="none"
        className="stroke-night/70 group-hover/n:stroke-pitch group-focus-visible/n:stroke-pitch"
        strokeWidth={2.5}
      />
    </>
  );
  // Real SVG <a href> so middle-click / open-in-new-tab work after SPA removal.
  // Opacity lives on an inner <g> — SVG <a> is typed as HTMLAnchorElement and
  // does not accept the SVG opacity attribute.
  if (href) {
    return (
      <a href={href} className="group/n cursor-pointer focus:outline-none" aria-label={label}>
        <g opacity={eliminated ? 0.45 : 1}>{disc}</g>
      </a>
    );
  }
  return (
    <g className="group/n" aria-label={label} opacity={eliminated ? 0.45 : 1}>
      {disc}
    </g>
  );
}

function ThirdPlaceChip({
  match,
  comp,
  t,
}: {
  match: ResolvedBracketMatch;
  comp: string;
  t: (k: string) => string;
}) {
  const href = match.match
    ? pathFor({ kind: 'match', comp, slug: match.match.slug })
    : undefined;
  const cls =
    'flex items-center gap-2 rounded-pill border border-line bg-panel px-3 py-1.5 shadow-panel transition-colors hover:border-pitch';
  const inner = (
    <>
      <span className="ds-caption uppercase tracking-[0.14em] text-chalkdim/70">
        {t('bracket.3rd')}
      </span>
      <Crest team={match.home} t={t} />
      <span className="ds-caption text-chalkdim/50">–</span>
      <Crest team={match.away} t={t} />
    </>
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <span className={`${cls} cursor-default hover:border-line opacity-70`} aria-disabled="true">
      {inner}
    </span>
  );
}

function Crest({ team, t }: { team: ResolvedTeam | null; t: (k: string) => string }) {
  if (!team) return <span className="ds-caption text-chalkdim/40">{t('bracket.tbd')}</span>;
  return team.flag ? (
    <img
      src={team.flag}
      alt={team.label}
      title={team.label}
      className="w-6 h-4 object-cover rounded-micro"
    />
  ) : (
    <span className="ds-caption text-chalk">{team.label}</span>
  );
}
