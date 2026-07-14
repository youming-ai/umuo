import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConferenceTable } from '../adapters/types';
import ConferenceStandings from './ConferenceStandings';

const conferences: ConferenceTable[] = [
  {
    name: 'Eastern Conference',
    rows: [
      { teamId: '2', name: 'Boston Celtics', logo: '', w: 30, l: 12, pct: '.714', gb: '-' },
      { teamId: '20', name: 'New York Knicks', logo: '', w: 27, l: 15, pct: '.643', gb: '3' },
    ],
  },
  {
    name: 'Western Conference',
    rows: [
      { teamId: '13', name: 'Los Angeles Lakers', logo: '', w: 28, l: 14, pct: '.667', gb: '-' },
    ],
  },
];

describe('ConferenceStandings', () => {
  it('renders one table per conference with team rows', () => {
    render(<ConferenceStandings conferences={conferences} />);
    expect(screen.getByText('Eastern Conference')).toBeInTheDocument();
    expect(screen.getByText('Western Conference')).toBeInTheDocument();
    expect(screen.getByText('Boston Celtics')).toBeInTheDocument();
    expect(screen.getByText('Los Angeles Lakers')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('renders W/L/PCT/GB values', () => {
    render(<ConferenceStandings conferences={conferences} />);
    expect(screen.getByText('.714')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // Knicks GB
  });

  it('does not make rows clickable (no buttons/links in the tables)', () => {
    render(<ConferenceStandings conferences={conferences} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the empty message when there are no conferences', () => {
    render(<ConferenceStandings conferences={[]} />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });
});
