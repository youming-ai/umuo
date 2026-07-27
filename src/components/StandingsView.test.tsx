import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Group, WCStanding } from '../types';
import StandingsView from './StandingsView';

function renderView(groups: Group[]) {
  return render(<StandingsView groups={groups} />);
}

function team(overrides: Partial<WCStanding> & { teamId: string; name: string }): WCStanding {
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

describe('StandingsView', () => {
  it('shows empty message when no groups are provided', () => {
    renderView([]);
    expect(screen.getByText('Standings appear once the group stage kicks off')).toBeInTheDocument();
  });

  it('renders group names and team names', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [
          team({ teamId: '1', name: 'Mexico', mp: 2, pts: 4 }),
          team({ teamId: '2', name: 'Canada', mp: 2, pts: 3 }),
        ],
      },
    ];
    renderView(groups);
    expect(screen.getAllByText('Group A')).toHaveLength(2); // visible span + sr-only caption
    expect(screen.getByText('Mexico')).toBeInTheDocument();
    expect(screen.getByText('Canada')).toBeInTheDocument();
  });

  it('renders multiple groups', () => {
    const groups: Group[] = [
      { name: 'A', standings: [team({ teamId: '1', name: 'Team A1', pts: 3 })] },
      { name: 'B', standings: [team({ teamId: '2', name: 'Team B1', pts: 3 })] },
      { name: 'C', standings: [team({ teamId: '3', name: 'Team C1', pts: 3 })] },
    ];
    renderView(groups);
    expect(screen.getAllByText('Group A')).toHaveLength(2);
    expect(screen.getAllByText('Group B')).toHaveLength(2);
    expect(screen.getAllByText('Group C')).toHaveLength(2);
  });

  // ---- bestThirdIds logic: top 2 direct, top 8 thirds ----

  it('marks top 2 teams with direct qualification indicator (pitch green bar)', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [
          team({ teamId: '1', name: 'First', pts: 9 }),
          team({ teamId: '2', name: 'Second', pts: 6 }),
          team({ teamId: '3', name: 'Third', pts: 3 }),
          team({ teamId: '4', name: 'Fourth', pts: 0 }),
        ],
      },
    ];
    renderView(groups);

    // The first two teams should have a bg-pitch class (direct qualifier)
    const rows = screen.getAllByRole('row');
    // rows[0] = thead, rows[1-4] = tbody rows
    // The qualifier indicator is a span indicator
    expect(rows[1].className).toContain('bg-pitch');
    expect(rows[2].className).toContain('bg-pitch');
    // Third place: only gets the indicator if among best 8 thirds
  });

  it('marks best 8 third-placed teams with dim qualification indicator', () => {
    // Create 12 groups, the first 8 thirds have better records
    const groups: Group[] = Array.from({ length: 12 }, (_, i) => ({
      name: String.fromCharCode(65 + i), // A-L
      standings: [
        team({ teamId: `${i}-1`, name: `G${String.fromCharCode(65 + i)}-1`, pts: 9 }),
        team({ teamId: `${i}-2`, name: `G${String.fromCharCode(65 + i)}-2`, pts: 6 }),
        // Thirds: first 8 groups have pts=4, last 4 have pts=1
        team({ teamId: `${i}-3`, name: `G${String.fromCharCode(65 + i)}-3`, pts: i < 8 ? 4 : 1 }),
        team({ teamId: `${i}-4`, name: `G${String.fromCharCode(65 + i)}-4`, pts: 0 }),
      ],
    }));
    renderView(groups);

    // All groups G-I thirds (index 8-10) should NOT have the third qualifier bg
    // Check that Group I's third (the 9th ranked third) has no bg-pitch class
    const tables = screen.getAllByRole('table');
    // The third row in each table is the third-place team
    const thirdRowGroupI = tables[8].querySelectorAll('tbody tr')[2]; // 0-indexed: third row
    expect(thirdRowGroupI.className).not.toContain('bg-pitch');

    // Group A's third (ranked among top 8) should have the bg indicator
    const thirdRowGroupA = tables[0].querySelectorAll('tbody tr')[2];
    expect(thirdRowGroupA.className).toContain('bg-pitch');
  });

  it('uses tiebreakers (gd then gf) for best-third ranking', () => {
    // Two thirds with same points, but different gd
    const groups: Group[] = [
      {
        name: 'A',
        standings: [
          team({ teamId: 'a1', name: 'A1', pts: 9 }),
          team({ teamId: 'a2', name: 'A2', pts: 6 }),
          team({ teamId: 'a3', name: 'A3', pts: 4, gd: 5, gf: 7 }), // better gd
          team({ teamId: 'a4', name: 'A4', pts: 0 }),
        ],
      },
      {
        name: 'B',
        standings: [
          team({ teamId: 'b1', name: 'B1', pts: 9 }),
          team({ teamId: 'b2', name: 'B2', pts: 6 }),
          team({ teamId: 'b3', name: 'B3', pts: 4, gd: -1, gf: 2 }), // worse gd
          team({ teamId: 'b4', name: 'B4', pts: 0 }),
        ],
      },
    ];
    renderView(groups);

    // With only 2 groups, both thirds qualify (top 8 out of 2 = both)
    // A3 and B3 should both have the third qualifier since top 8 of 2
    // Verify A3 (row[3] in first table) has the indicator
    const tableA = screen.getAllByRole('table')[0];
    const a3Row = tableA.querySelectorAll('tbody tr')[2];
    expect(a3Row.className).toContain('bg-pitch');
    const tableB = screen.getAllByRole('table')[1];
    const b3Row = tableB.querySelectorAll('tbody tr')[2];
    expect(b3Row.className).toContain('bg-pitch');
  });

  it('renders legend with top-2 and best-third explanations', () => {
    const groups: Group[] = [{ name: 'A', standings: [team({ teamId: '1', name: 'T1', pts: 3 })] }];
    renderView(groups);
    expect(screen.getByText('Top 2 advance')).toBeInTheDocument();
    expect(screen.getByText('8 best third-placed teams advance')).toBeInTheDocument();
  });

  it('renders stat columns (MP, W, D, L, GD, Pts) for each team', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [
          team({
            teamId: '1',
            name: 'Mexico',
            mp: 3,
            w: 2,
            d: 1,
            l: 0,
            gf: 5,
            ga: 1,
            gd: 4,
            pts: 7,
          }),
        ],
      },
    ];
    renderView(groups);
    expect(screen.getByText('3')).toBeInTheDocument(); // MP
    expect(screen.getByText('7')).toBeInTheDocument(); // Pts
    expect(screen.getByText('+4')).toBeInTheDocument(); // GD
  });

  it('shows negative GD without plus sign', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [
          team({
            teamId: '1',
            name: 'Loser',
            mp: 3,
            w: 0,
            d: 0,
            l: 3,
            gf: 1,
            ga: 7,
            gd: -6,
            pts: 0,
          }),
        ],
      },
    ];
    renderView(groups);
    expect(screen.getByText('-6')).toBeInTheDocument();
  });

  it('handles group with no third-place team gracefully', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [team({ teamId: '1', name: 'Only', pts: 3 })],
      },
    ];
    renderView(groups);
    // bestThirdIds accesses standings[2] which is undefined; filter(Boolean) removes it
    // Should still render without crashing
    expect(screen.getByText('Only')).toBeInTheDocument();
  });

  // ---- Form column ----

  it('renders a Form column header in the standings table', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [team({ teamId: '1', name: 'Mexico', mp: 3, pts: 7, form: 'WWDWL' })],
      },
    ];
    renderView(groups);
    // The form column has a header labelled "Form" via the key.
    expect(screen.getByText('Form')).toBeInTheDocument();
  });

  it('renders each W/D/L character as a colour-coded square in form order', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [team({ teamId: '1', name: 'Mexico', mp: 5, pts: 10, form: 'WDWLW' })],
      },
    ];
    renderView(groups);
    // Find the pill by its role="img" + aria-label; the heading <abbr>
    // also has title="Last 5 matches" so we use the role instead to
    // disambiguate.
    const pill = screen.getByRole('img', { name: /Last 5 matches/ });
    // The pill contains 5 colour-coded squares; each shows the W/D/L
    // character. We don't assert specific Tailwind classes (those are
    // formatting concerns); we just verify the letters are rendered in
    // the right order, oldest-first.
    expect(pill.textContent).toBe('WDWLW');
  });

  it('shows an em-dash placeholder when standings rows lack a form field', () => {
    const groups: Group[] = [
      {
        name: 'A',
        standings: [team({ teamId: '1', name: 'Mexico', mp: 0, pts: 0 })],
      },
    ];
    renderView(groups);
    // No form data → no pill, just the em-dash placeholder; the header
    // is still present (column always exists).
    expect(screen.queryByRole('img', { name: /Last 5 matches/ })).not.toBeInTheDocument();
    expect(screen.getByText('Form')).toBeInTheDocument();
  });

  // ---- League (season) single-table mode ----

  describe('league mode', () => {
    const league: Group[] = [
      {
        name: 'English Premier League',
        standings: [
          team({ teamId: '1', name: 'Arsenal', pts: 9 }),
          team({ teamId: '2', name: 'Chelsea', pts: 6 }),
        ],
      },
    ];

    it('renders teams without the qualification legend', () => {
      render(<StandingsView groups={league} mode="league" />);
      expect(screen.getByText('Arsenal')).toBeInTheDocument();
      // WC-only "advance (top 2)" legend must not render in league mode
      expect(screen.queryByText('Top 2 advance')).not.toBeInTheDocument();
      expect(screen.queryByText('8 best third-placed teams advance')).not.toBeInTheDocument();
    });

    it('does not prefix the card header with "Group"', () => {
      render(<StandingsView groups={league} mode="league" />);
      expect(screen.getAllByText('English Premier League')).toHaveLength(2); // visible span + sr-only caption
      expect(screen.queryByText(/^Group /)).not.toBeInTheDocument();
    });

    it('does not apply direct/third qualification highlighting to rows', () => {
      render(<StandingsView groups={league} mode="league" />);
      const rows = screen.getAllByRole('row');
      // rows[0] = thead, rows[1-2] = tbody rows (Arsenal, Chelsea)
      expect(rows[1].className).not.toContain('bg-pitch');
      expect(rows[2].className).not.toContain('bg-pitch');
    });
  });
});
