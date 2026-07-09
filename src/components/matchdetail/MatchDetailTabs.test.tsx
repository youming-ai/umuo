import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { PlayEvent, TeamLineup, TeamStatRow } from '../../types';
import LineupTab from './LineupTab';
import PlayByPlayTab from './PlayByPlayTab';
import TeamStatsTab from './TeamStatsTab';

const wrap = (ui: ReactNode) => render(ui);

describe('TeamStatsTab', () => {
  it('renders a row per stat with both values', () => {
    const stats: TeamStatRow[] = [{ label: 'Shots', home: '21', away: '14' }];
    wrap(<TeamStatsTab stats={stats} />);
    expect(screen.getByText('Shots')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('shows empty state when there are no stats', () => {
    wrap(<TeamStatsTab stats={[]} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders fractional %-labeled stats as whole percentages', () => {
    const stats: TeamStatRow[] = [{ label: 'Pass Completion %', home: '0.9', away: '0.86' }];
    wrap(<TeamStatsTab stats={stats} />);
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('86%')).toBeInTheDocument();
  });

  it('leaves pre-scaled possession % untouched', () => {
    const stats: TeamStatRow[] = [{ label: 'Possession %', home: '60.5', away: '39.5' }];
    wrap(<TeamStatsTab stats={stats} />);
    expect(screen.getByText('60.5')).toBeInTheDocument();
    expect(screen.getByText('39.5')).toBeInTheDocument();
  });

  it('leaves non-% counts untouched', () => {
    const stats: TeamStatRow[] = [{ label: 'Shots', home: '21', away: '14' }];
    wrap(<TeamStatsTab stats={stats} />);
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });
});

describe('PlayByPlayTab', () => {
  const allPlays: PlayEvent[] = [{ clock: "3'", text: 'Foul.', teamId: null, type: '' }];
  const keyPlays: PlayEvent[] = [{ clock: "9'", text: 'Goal!', teamId: '203', type: 'Goal' }];
  const allPlaysWithTeam: PlayEvent[] = [{ clock: "3'", text: 'Tackle.', teamId: '203', type: '' }];

  it('shows all plays by default and switches to key plays', () => {
    wrap(<PlayByPlayTab allPlays={allPlays} keyPlays={keyPlays} homeId="203" />);
    expect(screen.getByText('Foul.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Key Plays'));
    expect(screen.getByText('Goal!')).toBeInTheDocument();
  });

  it('surfaces the event type label when switching to Key Plays', () => {
    wrap(<PlayByPlayTab allPlays={allPlays} keyPlays={keyPlays} homeId="203" />);
    fireEvent.click(screen.getByText('Key Plays'));
    expect(screen.getByText('Goal')).toBeInTheDocument();
  });

  it('does NOT apply border-l-2 in All Plays even when teamId is set, but DOES in Key Plays', () => {
    const { container } = wrap(
      <PlayByPlayTab allPlays={allPlaysWithTeam} keyPlays={keyPlays} homeId="203" />,
    );
    // All Plays tab is active by default — teamId is set but border should NOT appear
    let li = container.querySelector('li')!;
    expect(li.className).not.toContain('border-l-2');

    // Switch to Key Plays — now the border SHOULD appear
    fireEvent.click(screen.getByText('Key Plays'));
    li = container.querySelector('li')!;
    expect(li.className).toContain('border-l-2');
  });
});

describe('LineupTab', () => {
  const lineups: TeamLineup[] = [
    {
      teamId: '203',
      teamName: 'Mexico',
      formation: '4-3-3',
      players: [
        { jersey: '1', name: 'Rangel', pos: 'G', starter: true },
        { jersey: '9', name: 'Jiménez', pos: 'F', starter: true },
        { jersey: '14', name: 'Bench Guy', pos: 'M', starter: false, subbedInAt: "82'" },
      ],
    },
    { teamId: '467', teamName: 'South Africa', formation: '4-2-3-1', players: [] },
  ];

  it('renders the home formation, a starter, and a bench player', () => {
    wrap(<LineupTab lineups={lineups} homeId="203" />);
    expect(screen.getByText('4-3-3')).toBeInTheDocument();
    expect(screen.getByText('Jiménez')).toBeInTheDocument();
    expect(screen.getByText('Bench Guy')).toBeInTheDocument();
  });

  it('shows a ↓ subbed-out marker on a pitch starter', () => {
    const withSubOut: TeamLineup[] = [
      {
        teamId: '203',
        teamName: 'Mexico',
        formation: '4-3-3',
        players: [
          { jersey: '1', name: 'Rangel', pos: 'G', starter: true },
          { jersey: '9', name: 'Jiménez', pos: 'F', starter: true, subbedOutAt: "67'" },
        ],
      },
      { teamId: '467', teamName: 'South Africa', formation: '4-2-3-1', players: [] },
    ];
    wrap(<LineupTab lineups={withSubOut} homeId="203" />);
    expect(screen.getByText("↓ 67'")).toBeInTheDocument();
  });
});
