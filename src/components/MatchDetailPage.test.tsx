import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { CompMatch, Match } from '../types';
import MatchDetailPage from './MatchDetailPage';

const liveStream: Match = {
  id: 1,
  name: 'Netherlands vs. Morocco',
  category_name: 'Football',
  iframe: 'https://ppv.st/embed/123',
  viewers: '7',
  substreams: [],
  slug: 'netherlands-vs-morocco',
  alwaysLive: true,
};

function setPath(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname },
    writable: true,
    configurable: true,
  });
}

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
beforeEach(() => {
  fetchMock.mockReset();
  setPath('/fifa.world');
});

const match: CompMatch = {
  id: '760420',
  homeName: 'Mexico',
  awayName: 'South Africa',
  homeFlag: '',
  awayFlag: '',
  homeId: '203',
  awayId: '492',
  homeScore: 2,
  awayScore: 0,
  group: 'A',
  kickoff: new Date('2026-06-13T19:00Z'),
  status: 'finished',
  stage: 'group',
  homeScorers: [],
  awayScorers: [],
  venue: '',
  slug: 'mexico-vs-south-africa',
};

function summaryJson() {
  return {
    header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '203' } }] }] },
    boxscore: {
      teams: [{ team: { id: '203' }, statistics: [{ label: 'Shots', displayValue: '21' }] }],
    },
    commentary: [],
    keyEvents: [],
    rosters: [],
    gameInfo: {},
  };
}

it('renders the match header (home : away) and the back button', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  const onBack = vi.fn();
  render(
    <LanguageProvider>
      <MatchDetailPage match={match} onBack={onBack} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  // Header is rendered with the score and team names.
  expect(screen.getByText('Mexico')).toBeInTheDocument();
  expect(screen.getByText('South Africa')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect(onBack).toHaveBeenCalled();
});

it('renders the live stream player at the top when a live stream is provided', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  render(
    <LanguageProvider>
      <MatchDetailPage match={match} stream={liveStream} onBack={vi.fn()} />
    </LanguageProvider>,
  );
  // The Player renders the stream name as a heading and an iframe titled with it.
  expect(
    await screen.findByRole('heading', { name: 'Netherlands vs. Morocco' }),
  ).toBeInTheDocument();
  expect(screen.getByTitle('Netherlands vs. Morocco')).toBeInTheDocument();
});

it('does not render a player when no live stream is provided', async () => {
  // App pre-filters to a live stream and passes null otherwise, so the page
  // simply renders the player when a stream prop is present.
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  render(
    <LanguageProvider>
      <MatchDetailPage match={match} stream={null} onBack={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  expect(
    screen.queryByRole('heading', { name: 'Netherlands vs. Morocco' }),
  ).not.toBeInTheDocument();
});

it('shows the penalty-shootout score and a Pens badge for a pens match', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  const pensMatch: CompMatch = {
    ...match,
    homeScore: 1,
    awayScore: 1,
    stage: 'r16',
    finishType: 'pens',
    homeShootoutScore: 3,
    awayShootoutScore: 4,
    winner: 'away',
  };
  render(
    <LanguageProvider>
      <MatchDetailPage match={pensMatch} onBack={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  expect(screen.getByText('Pens')).toBeInTheDocument();
  expect(screen.getByText('(3)')).toBeInTheDocument();
  expect(screen.getByText('(4)')).toBeInTheDocument();
});

it('shows an AET badge for an extra-time decider', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  const aetMatch: CompMatch = { ...match, stage: 'qf', finishType: 'aet' };
  render(
    <LanguageProvider>
      <MatchDetailPage match={aetMatch} onBack={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  expect(screen.getByText('AET')).toBeInTheDocument();
});

it('shows an i18n error with a retry button that refetches', async () => {
  fetchMock
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  const onBack = vi.fn();
  render(
    <LanguageProvider>
      <MatchDetailPage match={match} onBack={onBack} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(screen.getByText('Failed to load data')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

const nbaMatch: CompMatch = {
  id: '401585',
  homeName: 'Los Angeles Lakers',
  awayName: 'Boston Celtics',
  homeFlag: '',
  awayFlag: '',
  homeId: '13',
  awayId: '2',
  homeScore: 112,
  awayScore: 108,
  kickoff: new Date('2026-01-15T00:30Z'),
  status: 'finished',
  statusText: 'Final',
  homeScorers: [],
  awayScorers: [],
  venue: '',
  slug: 'los-angeles-lakers-vs-boston-celtics-401585',
};

function nbaSummaryJson() {
  return {
    header: {
      competitions: [
        {
          competitors: [
            { homeAway: 'home', team: { id: '13' } },
            { homeAway: 'away', team: { id: '2' } },
          ],
        },
      ],
    },
    boxscore: {
      teams: [{ team: { id: '13' }, statistics: [{ label: 'REB', displayValue: '45' }] }],
      players: [
        {
          team: { id: '13', displayName: 'Los Angeles Lakers' },
          statistics: [
            {
              labels: ['MIN', 'PTS'],
              athletes: [
                {
                  starter: true,
                  didNotPlay: false,
                  athlete: { displayName: 'L. James' },
                  stats: ['38', '30'],
                },
              ],
            },
          ],
        },
      ],
    },
    gameInfo: {},
  };
}

it('shows Boxscore + Stats tabs for an NBA match (no Lineup / Play-By-Play)', async () => {
  setPath('/nba');
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => nbaSummaryJson() });
  render(
    <LanguageProvider>
      <MatchDetailPage match={nbaMatch} onBack={vi.fn()} />
    </LanguageProvider>,
  );
  // Boxscore tab renders the player once the summary resolves
  expect(await screen.findByText('L. James')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Box Score' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Stats' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Lineup' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Play-By-Play' })).not.toBeInTheDocument();
});

it('shows the NBA statusText and no stage label in the hero', async () => {
  setPath('/nba');
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => nbaSummaryJson() });
  render(
    <LanguageProvider>
      <MatchDetailPage match={nbaMatch} onBack={vi.fn()} />
    </LanguageProvider>,
  );
  await screen.findByText('L. James');
  // no soccer stage/group chip in the hero (nbaMatch has no stage)
  expect(screen.queryByText(/^Group /)).not.toBeInTheDocument();
});
