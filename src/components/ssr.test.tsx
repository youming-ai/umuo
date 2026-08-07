// @vitest-environment node
// The content islands render on the server (client:load), so they must produce
// real HTML without touching window/document — and must produce it identically
// on both sides, since a hydration mismatch throws the SSR markup away. Node
// environment on purpose: `document` is undefined here, exactly like workerd.
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { CompMatch } from '../types';
import ExploreView from './explore/ExploreView';
import FixturesView from './FixturesView';
import MatchDetailIsland from './MatchDetailIsland';
import OddsView from './OddsView';
import TeamPageIsland from './TeamPageIsland';

const match: CompMatch = {
  id: '1',
  homeName: 'Arsenal',
  awayName: 'Chelsea',
  homeFlag: '',
  awayFlag: '',
  homeId: '1',
  awayId: '2',
  homeScore: null,
  awayScore: null,
  kickoff: new Date('2026-08-01T18:30:00Z'),
  status: 'upcoming',
  homeScorers: [],
  awayScorers: [],
  venue: 'Emirates',
  slug: 'arsenal-vs-chelsea',
};

it('renders fixtures server-side with team names in the markup', () => {
  const html = renderToString(
    <FixturesView comp="eng.1" matches={[match]} standings={{ kind: 'soccer', groups: [] }} />,
  );
  expect(html).toContain('Arsenal');
  expect(html).toContain('Chelsea');
  expect(html).toContain('Emirates');
});

it('stamps the machine-readable instant on every rendered time', () => {
  const html = renderToString(
    <FixturesView comp="eng.1" matches={[match]} standings={{ kind: 'soccer', groups: [] }} />,
  );
  expect(html).toContain('2026-08-01T18:30:00.000Z');
});

// The match and team pages 503 without upstream data, so a live smoke test never
// reaches their islands — cover them here instead.
it('renders the match-detail island server-side', () => {
  const html = renderToString(
    <MatchDetailIsland
      comp="eng.1"
      match={{ ...match, status: 'finished', homeScore: 2, awayScore: 1 }}
      initialDetail={null}
    />,
  );
  expect(html).toContain('Arsenal');
  expect(html).toContain('/eng.1/schedule');
});

it('renders the team-page island server-side', () => {
  const html = renderToString(
    <TeamPageIsland
      comp="eng.1"
      team={{
        id: '359',
        name: 'Arsenal',
        logo: '',
        record: '20-5-3',
        standingSummary: '1st in Premier League',
        roster: [],
        schedule: [],
        injuries: [],
      }}
    />,
  );
  expect(html).toContain('Arsenal');
  expect(html).toContain('/eng.1/teams');
});

// The odds page renders LocalTime on a path the live smoke test never reaches
// (it needs a match with a kickoff AND an odds block).
it('renders the odds board server-side with a UTC kickoff', () => {
  const html = renderToString(
    <OddsView
      matches={[
        {
          ...match,
          odds: {
            provider: 'DraftKings',
            details: 'ARS -120',
            spread: -0.5,
            overUnder: 2.5,
            homeMoneyLine: -120,
            awayMoneyLine: 300,
            drawMoneyLine: 240,
          },
        },
      ]}
    />,
  );
  expect(html).toContain('DraftKings');
  expect(html).toContain('+240');
  expect(html).toContain('2026-08-01T18:30:00.000Z');
});

// The Explore bar now carries the wordmark and the theme switcher, and the
// whole island is SSR'd via client:load. ThemeSwitcher therefore must not read
// localStorage during render — there is no `window` here, exactly like workerd,
// and a differing first client render would throw the SSR markup away.
it('renders the Explore shell server-side without touching browser globals', () => {
  const html = renderToString(
    <ExploreView
      initialData={{ items: [], nextCursor: null }}
      initialFilters={{ competitions: [], sources: [], tags: [] }}
    />,
  );
  expect(html).toContain('umu');
  expect(html).toContain('Search stories');
  // Icon-less until mount: an icon in the SSR markup would mean the switcher
  // guessed a theme on the server.
  expect(html).not.toContain('<svg');
});
