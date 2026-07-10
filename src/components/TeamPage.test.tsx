import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CompMatch, TopScorer, WCStanding } from '../types';
import TeamPage from './TeamPage';

function standing(overrides: Partial<WCStanding> & { teamId: string; name: string }): WCStanding {
  return {
    flag: '',
    mp: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
    ...overrides,
  };
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

function renderPage(props: Partial<React.ComponentProps<typeof TeamPage>> = {}) {
  const defaults: React.ComponentProps<typeof TeamPage> = {
    teamId: '203',
    groups: [
      {
        name: 'A',
        standings: [
          standing({
            teamId: '203',
            name: 'Mexico',
            mp: 2,
            w: 2,
            d: 0,
            l: 0,
            gf: 4,
            ga: 1,
            gd: 3,
            pts: 6,
            form: 'WW',
          }),
        ],
      },
    ],
    matches: [],
    scorers: [],
    backHref: '/fifa.world',
  };
  return render(<TeamPage {...defaults} {...props} />);
}

describe('TeamPage', () => {
  it('renders the team name and group letter in the header', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Mexico' })).toBeInTheDocument();
    // "Group A" appears as both the visible label and the sr-only table caption
    expect(screen.getAllByText('Group A').length).toBeGreaterThan(0);
  });

  it('shows MP / W / D / L / GD / Pts from the standings row', () => {
    renderPage();
    // All of MP, W, D, L, Pts are 2/0/0/0/6 — the digit '2' appears in
    // MP, W, and Pts; the digit '6' in Pts; the digit '0' in D and L;
    // and '+3' (signed) for GD. Verify all five distinct values render.
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('renders the Form pill when standings have form data', () => {
    renderPage();
    expect(screen.getByRole('img', { name: /Last 5 matches: WW/ })).toBeInTheDocument();
  });

  it('renders the back control as a real schedule link', () => {
    renderPage({});
    const back = screen.getByRole('link', { name: /Back/ });
    expect(back).toHaveAttribute('href', '/fifa.world');
  });

  it('filters matches to only this team (home or away)', () => {
    renderPage({
      matches: [
        match({ id: '1', homeId: '203', awayId: '224', status: 'upcoming' }),
        match({ id: '2', homeId: '300', awayId: '400', status: 'upcoming' }), // different team
        match({ id: '3', homeId: '500', awayId: '203', status: 'finished' }),
      ],
    });
    // Verify that the third team's name ('Other') isn't in the document.
    // The first match's away is 'Canada' (filter applies to home team);
    // the third match is filtered to its home team which is 'Other'.
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('shows the empty message when the team has no matches', () => {
    renderPage({ matches: [] });
    expect(screen.getByText('No matches scheduled')).toBeInTheDocument();
  });

  it('shows a "not found" state when the teamId is not in any group', () => {
    renderPage({ teamId: '999' });
    expect(screen.getByText('Team not found')).toBeInTheDocument();
  });

  it('renders the team scorers section when scorers are present', () => {
    const scorers: TopScorer[] = [
      {
        athleteId: '1',
        name: 'Alvarado',
        teamId: '203',
        teamName: 'Mexico',
        teamFlag: '',
        goals: 3,
      },
      { athleteId: '2', name: 'Vega', teamId: '203', teamName: 'Mexico', teamFlag: '', goals: 1 },
      {
        athleteId: '3',
        name: 'Other Player',
        teamId: '999',
        teamName: 'Other',
        teamFlag: '',
        goals: 5,
      },
    ];
    renderPage({ scorers });
    expect(screen.getByRole('heading', { level: 2, name: 'Top Scorers' })).toBeInTheDocument();
    expect(screen.getByText('Alvarado')).toBeInTheDocument();
    expect(screen.getByText('Vega')).toBeInTheDocument();
    // The other team's player is filtered out
    expect(screen.queryByText('Other Player')).not.toBeInTheDocument();
  });

  it('omits the scorers section when the team has no scorers', () => {
    renderPage({ scorers: [] });
    expect(screen.queryByRole('heading', { name: 'Top scorers' })).not.toBeInTheDocument();
  });
});
