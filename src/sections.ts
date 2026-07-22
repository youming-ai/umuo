// Single source of truth for the per-competition sections: which exist, their
// path suffix under /<comp>, their nav label, and the capability that gates
// them. router.ts (Section type + suffix map), LeftNav (nav items), and
// sitemap.xml.ts (crawlable paths) all derive from this array — so the set,
// order, labels, and gates never drift across those three. Pure data, no
// DOM/React deps, compiles under both tsconfigs like competitions.ts.

export type Section = 'news' | 'schedule' | 'stats' | 'teams' | 'transactions' | 'odds';

export interface SectionDef {
  section: Section;
  suffix: string; // path under /<comp>; '' = the news-hub root
  label: string; // nav label
  capability?: 'scorers' | 'transactions' | 'odds'; // capabilities key gating it; undefined = always shown
}

// Order IS the nav order (News, Schedule, Teams, Stats, Moves, Odds).
export const SECTIONS: SectionDef[] = [
  { section: 'news', suffix: '', label: 'News' },
  { section: 'schedule', suffix: '/schedule', label: 'Schedule' },
  { section: 'teams', suffix: '/teams', label: 'Teams' },
  { section: 'stats', suffix: '/stats', label: 'Stats', capability: 'scorers' },
  { section: 'transactions', suffix: '/transactions', label: 'Moves', capability: 'transactions' },
  { section: 'odds', suffix: '/odds', label: 'Odds', capability: 'odds' },
];
