import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConferenceTable } from '../adapters/types';
import { LanguageProvider } from '../i18n';
import type { CompMatch, TopScorer, WCGroup } from '../types';
import * as router from '../utils/router';
import FixturesView from './FixturesView';

function renderView(matches: CompMatch[], groups: WCGroup[] = [], scorers: never[] = []) {
  return render(
    <LanguageProvider>
      <FixturesView
        section="matches"
        matches={matches}
        standings={{ kind: 'soccer', groups }}
        scorers={scorers}
      />
    </LanguageProvider>,
  );
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

  it('shows the group standings table only when the Group stage filter is active', () => {
    const group: WCGroup = {
      name: 'A',
      standings: [
        {
          teamId: '203',
          name: 'Mexico',
          flag: '',
          mp: 1,
          w: 1,
          d: 0,
          l: 0,
          gf: 2,
          ga: 0,
          gd: 2,
          pts: 3,
        },
        {
          teamId: '224',
          name: 'Canada',
          flag: '',
          mp: 1,
          w: 0,
          d: 0,
          l: 1,
          gf: 0,
          ga: 2,
          gd: -2,
          pts: 0,
        },
      ],
    };
    renderView([match({ id: '1', stage: 'group' })], [group]);
    // Default 'all' stage: standings are not shown (no table).
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const stageChip = screen.getByRole('button', { name: 'Group stage' });
    fireEvent.click(within(stageChip.parentElement!).getByRole('button', { name: 'Group stage' }));

    // Selecting the group stage surfaces the standings table on top.
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows a friendly empty state when filter has no matches', () => {
    renderView([match({ id: '1', status: 'upcoming' })]);

    fireEvent.click(screen.getByRole('button', { name: /^Finished\s+0$/ }));

    expect(screen.getByText('No finished matches yet')).toBeInTheDocument();
  });

  it('keeps stage filter chips functional alongside the status filter', () => {
    renderView([
      match({ id: '1', status: 'finished', stage: 'group' }),
      match({ id: '2', status: 'finished', stage: 'qf' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^Finished\s+2$/ }));

    // Click the Group stage chip within the stage filter row (not the status filter row)
    const stageChip = screen.getByRole('button', { name: 'Group stage' });
    const stageBar = stageChip.parentElement!;
    fireEvent.click(within(stageBar).getByRole('button', { name: 'Group stage' }));

    // Both finished matches were in different stages; filtering by Group
    // should leave only the group match visible. The status-filter counts
    // remain unfiltered (still 2).
    expect(screen.getAllByText('Mexico').length).toBe(1);
    expect(screen.getByRole('button', { name: /^Finished\s+2$/ })).toBeInTheDocument();
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
  render(
    <LanguageProvider>
      <FixturesView
        section="matches"
        matches={[]}
        standings={{ kind: 'soccer', groups: league }}
        scorers={[]}
      />
    </LanguageProvider>,
  );
  // league standings surface without needing a group-stage filter
  expect(screen.getByText('Arsenal')).toBeInTheDocument();
});

it('falls back to matches when a disabled section is requested (eng.1 bracket)', () => {
  setPath('/eng.1');
  render(
    <LanguageProvider>
      <FixturesView
        section="bracket"
        matches={[]}
        standings={{ kind: 'soccer', groups: league }}
        scorers={[]}
      />
    </LanguageProvider>,
  );
  // Should NOT render the bracket TBD grid; league table is shown instead
  expect(screen.queryByText('TBD')).not.toBeInTheDocument();
  expect(screen.getByText('Arsenal')).toBeInTheDocument();
});

it('rewrites the URL to the competition root when a disabled section is deep-linked', () => {
  setPath('/eng.1/bracket');
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
  render(
    <LanguageProvider>
      <FixturesView
        section="bracket"
        matches={[]}
        standings={{ kind: 'soccer', groups: league }}
        scorers={[]}
      />
    </LanguageProvider>,
  );
  // render falls back to matches AND the URL is made honest via replace
  expect(navSpy).toHaveBeenCalledWith('/eng.1', { replace: true });
  navSpy.mockRestore();
});

const conferences: ConferenceTable[] = [
  {
    name: 'Eastern Conference',
    rows: [{ teamId: '2', name: 'Boston Celtics', logo: '', w: 30, l: 12, pct: '.714', gb: '-' }],
  },
];

it('renders conference standings and hides stage chips for a basketball season comp', () => {
  setPath('/nba');
  render(
    <LanguageProvider>
      <FixturesView
        section="matches"
        matches={[]}
        standings={{ kind: 'basketball', conferences }}
        scorers={[]}
      />
    </LanguageProvider>,
  );
  expect(screen.getByText('Boston Celtics')).toBeInTheDocument();
  // season shape → no stage filter chips (no lone "Group stage")
  expect(screen.queryByRole('button', { name: 'Group stage' })).not.toBeInTheDocument();
});

// scoreboard-sourced (World Cup): scorers prop is mapped to Leader rows.
it('renders scoreboard-sourced scorers as a leaders board (World Cup)', () => {
  setPath('/fifa.world');
  const scorers: TopScorer[] = [
    {
      athleteId: '1',
      name: 'Erling Haaland',
      teamId: '464',
      teamName: 'Norway',
      teamFlag: '',
      goals: 4,
    },
  ];
  render(
    <LanguageProvider>
      <FixturesView
        section="scorers"
        matches={[]}
        standings={{ kind: 'soccer', groups: [] }}
        scorers={scorers}
      />
    </LanguageProvider>,
  );
  expect(screen.getByText('Erling Haaland')).toBeInTheDocument();
  // value cell shows the goal count as displayValue
  const cells = screen.getAllByRole('cell').filter((c) => c.className.includes('font-bold'));
  expect(cells.map((c) => c.textContent)).toEqual(['4']);
});
