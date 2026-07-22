import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CompMatch } from '../types';
import MatchDetailPage from './MatchDetailPage';

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
  setPath('/eng.1');
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
  kickoff: new Date('2026-06-13T19:00Z'),
  status: 'finished',
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
  render(<MatchDetailPage match={match} backHref="/eng.1" />);
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  // Header is rendered with the score and team names.
  expect(screen.getByText('Mexico')).toBeInTheDocument();
  expect(screen.getByText('South Africa')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
  const back = screen.getByRole('link', { name: /Back/ });
  expect(back).toHaveAttribute('href', '/eng.1');
});

it('links soccer team crests to their team page', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  render(<MatchDetailPage match={match} backHref="/eng.1" />);
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  // Team name sits inside an anchor pointing at /<comp>/team/<id>.
  expect(screen.getByText('Mexico').closest('a')).toHaveAttribute('href', '/eng.1/team/203');
  expect(screen.getByText('South Africa').closest('a')).toHaveAttribute('href', '/eng.1/team/492');
});

it('shows the penalty-shootout score and a Pens badge for a pens match', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  const pensMatch: CompMatch = {
    ...match,
    homeScore: 1,
    awayScore: 1,
    finishType: 'pens',
    homeShootoutScore: 3,
    awayShootoutScore: 4,
    winner: 'away',
  };
  render(<MatchDetailPage match={pensMatch} backHref="/eng.1" />);
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  expect(screen.getByText('Pens')).toBeInTheDocument();
  expect(screen.getByText('(3)')).toBeInTheDocument();
  expect(screen.getByText('(4)')).toBeInTheDocument();
});

it('shows an AET badge for an extra-time decider', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  const aetMatch: CompMatch = { ...match, finishType: 'aet' };
  render(<MatchDetailPage match={aetMatch} backHref="/eng.1" />);
  await waitFor(() => expect(screen.getByText('Shots')).toBeInTheDocument());
  expect(screen.getByText('AET')).toBeInTheDocument();
});

it('shows an error with a retry button that refetches', async () => {
  fetchMock
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => summaryJson() });
  render(<MatchDetailPage match={match} backHref="/eng.1" />);
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
  render(<MatchDetailPage match={nbaMatch} backHref="/eng.1" />);
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
  render(<MatchDetailPage match={nbaMatch} backHref="/eng.1" />);
  await screen.findByText('L. James');
  // no soccer stage/group chip in the hero (nbaMatch has no stage)
  expect(screen.queryByText(/^Group /)).not.toBeInTheDocument();
  // finished NBA fixture carries ESPN shortDetail as statusText
  expect(screen.getByText('Final')).toBeInTheDocument();
});

it('does not link NBA team crests (no basketball team page exists)', async () => {
  setPath('/nba');
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => nbaSummaryJson() });
  render(<MatchDetailPage match={nbaMatch} backHref="/eng.1" />);
  await screen.findByText('L. James');
  // Team names render as plain text, not anchors → no dead /nba/team/<id>
  // links. (The name also appears in the boxscore; assert none are anchored.)
  for (const el of screen.getAllByText('Los Angeles Lakers')) {
    expect(el.closest('a')).toBeNull();
  }
  for (const el of screen.getAllByText('Boston Celtics')) {
    expect(el.closest('a')).toBeNull();
  }
});
