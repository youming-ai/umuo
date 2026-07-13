import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TeamDetail } from '../types';
import TeamPage from './TeamPage';

function team(partial: Partial<TeamDetail> = {}): TeamDetail {
  return {
    id: '1',
    name: 'Argentina',
    logo: 'arg.png',
    record: '5-1',
    standingSummary: '1st in Group A',
    roster: [{ id: 'a1', name: 'Lionel Messi', jersey: '10', position: 'F' }],
    schedule: [
      { id: 'g1', date: '2026-06-11T19:00Z', name: 'Argentina vs Chile', detail: '2 - 1' },
    ],
    injuries: [{ name: 'Ángel Di María', status: 'Out', detail: 'hamstring' }],
    ...partial,
  };
}

describe('TeamPage', () => {
  it('renders header, roster, schedule and injuries', () => {
    render(<TeamPage team={team()} backHref="/fifa.world/teams" />);
    expect(screen.getByRole('heading', { name: 'Argentina', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('5-1 · 1st in Group A')).toBeInTheDocument();
    expect(screen.getByText('Lionel Messi')).toBeInTheDocument();
    expect(screen.getByText('Argentina vs Chile')).toBeInTheDocument();
    expect(screen.getByText('2 - 1')).toBeInTheDocument();
    expect(screen.getByText('Ángel Di María')).toBeInTheDocument();
    expect(screen.getByText('Out')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Teams/ })).toHaveAttribute(
      'href',
      '/fifa.world/teams',
    );
  });

  it('omits injuries when none and shows empty roster/schedule states', () => {
    render(
      <TeamPage team={team({ injuries: [], roster: [], schedule: [] })} backHref="/nba/teams" />,
    );
    expect(screen.queryByText('Injuries')).not.toBeInTheDocument();
    expect(screen.getByText('No roster available.')).toBeInTheDocument();
    expect(screen.getByText('No scheduled games.')).toBeInTheDocument();
  });
});
