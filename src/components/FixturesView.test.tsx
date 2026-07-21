import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConferenceTable } from '../adapters/types';
import type { CompMatch, WCGroup } from '../types';
import FixturesView from './FixturesView';

function renderView(matches: CompMatch[], groups: WCGroup[] = []) {
  return render(<FixturesView matches={matches} standings={{ kind: 'soccer', groups }} />);
}

function match(overrides: Partial<CompMatch> & { id: string }): CompMatch {
  return {
    homeName: 'Mexico',
    awayName: 'Canada',
    homeFlag: '',
    awayFlag: '',
    homeId: '203',
    awayId: '224',
    homeScore: 0,
    awayScore: 0,
    status: 'upcoming',
    kickoff: new Date('2026-06-15T20:00:00Z'),
    stage: 'group',
    group: 'A',
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: 'mexico-vs-canada',
    ...overrides,
  };
}

describe('FixturesView status filter', () => {
  it('renders the Upcoming / Finished chips with counts and no All chip', () => {
    renderView([
      match({ id: '1', status: 'finished', homeScore: 2, awayScore: 1 }),
      match({ id: '2', status: 'finished', homeScore: 0, awayScore: 0 }),
      match({ id: '3', status: 'upcoming' }),
    ]);
    expect(screen.getByRole('button', { name: /^Upcoming\s+1$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Finished\s+2$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^All\s+\d+$/ })).not.toBeInTheDocument();
  });

  it('defaults to the Upcoming filter (finished matches hidden)', () => {
    renderView([
      match({ id: '1', status: 'finished', homeName: 'A', awayName: 'B' }),
      match({ id: '2', status: 'upcoming', homeName: 'C', awayName: 'D' }),
    ]);
    // Upcoming match visible, finished hidden by default.
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('hides upcoming matches when Finished is selected', () => {
    renderView([
      match({ id: '1', status: 'finished', homeName: 'A', awayName: 'B' }),
      match({ id: '2', status: 'upcoming', homeName: 'C', awayName: 'D' }),
    ]);
    // Default Upcoming view: the upcoming match is visible.
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Finished\s+1$/ }));

    // The finished match remains, the upcoming one is gone
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
    expect(screen.queryByText('D')).not.toBeInTheDocument();
  });

  it('hides finished matches when Upcoming is selected', () => {
    renderView([
      match({ id: '1', status: 'finished', homeName: 'A', awayName: 'B' }),
      match({ id: '2', status: 'upcoming', homeName: 'C', awayName: 'D' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^Upcoming\s+1$/ }));

    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    // The "Results" section header should also be absent in the upcoming-only view
    expect(screen.queryByText('Results')).not.toBeInTheDocument();
  });

  it('shows a friendly empty state when filter has no matches', () => {
    renderView([match({ id: '1', status: 'upcoming' })]);

    fireEvent.click(screen.getByRole('button', { name: /^Finished\s+0$/ }));

    expect(screen.getByText('No finished matches yet')).toBeInTheDocument();
  });
});

function setPath(p: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: p },
    writable: true,
    configurable: true,
  });
}
const row = (teamId: string, name: string, pts: number) => ({
  teamId,
  name,
  flag: '',
  mp: 0,
  w: 0,
  d: 0,
  l: 0,
  gf: 0,
  ga: 0,
  gd: 0,
  pts,
});
const league: WCGroup[] = [{ name: 'Premier League', standings: [row('1', 'Arsenal', 9)] }];

it('shows the league table above fixtures for a season competition', () => {
  setPath('/eng.1');
  render(<FixturesView matches={[]} standings={{ kind: 'soccer', groups: league }} />);
  // league standings surface without needing a group-stage filter
  expect(screen.getByText('Arsenal')).toBeInTheDocument();
});

const conferences: ConferenceTable[] = [
  {
    name: 'Eastern Conference',
    rows: [{ teamId: '2', name: 'Boston Celtics', logo: '', w: 30, l: 12, pct: '.714', gb: '-' }],
  },
];

it('renders conference standings and hides stage chips for a basketball season comp', () => {
  setPath('/nba');
  render(<FixturesView matches={[]} standings={{ kind: 'basketball', conferences }} />);
  expect(screen.getByText('Boston Celtics')).toBeInTheDocument();
  // season shape → no stage filter chips (no lone "Group stage")
  expect(screen.queryByRole('button', { name: 'Group stage' })).not.toBeInTheDocument();
});
