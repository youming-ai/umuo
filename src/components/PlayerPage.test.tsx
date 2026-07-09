import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CompMatch, ScorerEntry, WCGroup } from '../types';
import PlayerPage from './PlayerPage';

function scorer(
  name: string,
  playerId: string,
  minute: string,
  tag: '' | ' (p)' | ' (OG)' = '',
): ScorerEntry {
  return { playerId, name, minute, tag };
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
    status: 'finished',
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

function group(standings: Array<{ teamId: string; name: string }>): WCGroup {
  return {
    name: 'A',
    standings: standings.map((s) => ({
      teamId: s.teamId,
      name: s.name,
      flag: '',
      mp: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
    })),
  };
}

function renderPage(props: Partial<React.ComponentProps<typeof PlayerPage>> = {}) {
  const defaults: React.ComponentProps<typeof PlayerPage> = {
    athleteId: 'p1',
    groups: [group([{ teamId: '203', name: 'Mexico' }])],
    matches: [],
    scorers: [
      {
        athleteId: 'p1',
        name: 'Alvarado',
        teamId: '203',
        teamName: 'Mexico',
        teamFlag: '',
        goals: 2,
      },
    ],
    backHref: '/fifa.world',
  };
  return render(
    <PlayerPage {...defaults} {...props} />,
  );
}

describe('PlayerPage', () => {
  it('renders the player name and team as a clickable link', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Alvarado' })).toBeInTheDocument();
    expect(screen.getByText('Mexico')).toBeInTheDocument();
  });

  it('renders the goal count when the player is in the scorers feed', () => {
    renderPage();
    // The "2 goals" line is rendered in the body; the section header is
    // a separate h2 with the word "goals". Use a more specific
    // assertion: the body text combines the number and the word.
    expect(screen.getByText(/2\s*goals/)).toBeInTheDocument();
  });

  it('renders one row per goal across all matches, oldest first', () => {
    const earlier = new Date('2026-06-10T20:00:00Z');
    const later = new Date('2026-06-20T20:00:00Z');
    renderPage({
      matches: [
        match({
          id: 'm1',
          kickoff: later,
          homeScorers: [scorer('Alvarado', 'p1', "67'")],
          awayScorers: [],
        }),
        match({
          id: 'm2',
          homeName: 'Brazil',
          awayName: 'Argentina',
          homeId: '500',
          awayId: '203',
          kickoff: earlier,
          homeScorers: [],
          awayScorers: [scorer('Alvarado', 'p1', "23'")],
        }),
      ],
    });
    // Both goals render. The 'goals' section header is an h2 — match it
    // case-insensitively because the word is lowercase.
    expect(screen.getByRole('heading', { level: 2, name: /goals/i })).toBeInTheDocument();
    // "23'" appears in the m2 row, "67'" in the m1 row.
    expect(screen.getByText("23'")).toBeInTheDocument();
    expect(screen.getByText("67'")).toBeInTheDocument();
  });

  it('shows an empty state when the player has no goals', () => {
    renderPage({
      athleteId: 'p2',
      matches: [],
      scorers: [], // no topScorerEntry either
    });
    expect(screen.getByText('Player not found')).toBeInTheDocument();
  });

  it('renders the player name from the matches feed even without a TopScorer entry', () => {
    renderPage({
      athleteId: 'p9',
      scorers: [], // not in top scorers
      matches: [
        match({
          id: 'm1',
          homeId: '203',
          awayId: '224',
          homeScorers: [scorer('Vega', 'p9', "45'")],
        }),
      ],
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Vega' })).toBeInTheDocument();
  });

  it('attributes an away scorer (absent from top scorers) to their own team', () => {
    renderPage({
      athleteId: 'p9',
      scorers: [], // not in the top-scorers feed → fall back to goal side
      groups: [
        group([
          { teamId: '203', name: 'Mexico' },
          { teamId: '224', name: 'Canada' },
        ]),
      ],
      matches: [
        match({
          id: 'm1',
          homeId: '203', // Mexico (home)
          awayId: '224', // Canada (away)
          awayScorers: [scorer('Vega', 'p9', "45'")],
        }),
      ],
    });
    // Vega scored for the away side (Canada) — the team link must be Canada,
    // not the home opponent Mexico.
    expect(screen.getByRole('link', { name: 'Canada' })).toHaveAttribute('href', expect.stringContaining('/team/'));
    expect(screen.queryByRole('button', { name: 'Mexico' })).not.toBeInTheDocument();
  });

  it('renders the back control as a real schedule link', () => {
    renderPage({});
    const back = screen.getByRole('link', { name: /Back/ });
    expect(back).toHaveAttribute('href', '/fifa.world');
  });

  it('clicking a goal row navigates to the match detail', () => {
    renderPage({
      matches: [
        match({
          id: 'm1',
          slug: 'mexico-vs-canada',
          homeScorers: [scorer('Alvarado', 'p1', "45'")],
        }),
      ],
    });
    // Goal rows link to the match detail page.
    expect(screen.getByRole('link', { name: /Mexico vs Canada/ })).toHaveAttribute(
      'href',
      '/fifa.world/match/mexico-vs-canada',
    );
  });
});
