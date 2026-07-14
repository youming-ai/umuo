import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BoxscoreTable } from '../../adapters/types';
import BoxscoreTab from './BoxscoreTab';

const tables: BoxscoreTable[] = [
  {
    teamId: '13',
    teamName: 'Los Angeles Lakers',
    labels: ['MIN', 'PTS', 'REB', 'AST'],
    players: [
      { name: 'L. James', starter: true, dnp: false, stats: ['38', '30', '8', '11'] },
      { name: 'B. Reserve', starter: false, dnp: true, stats: [] },
    ],
  },
  {
    teamId: '2',
    teamName: 'Boston Celtics',
    labels: ['MIN', 'PTS', 'REB', 'AST'],
    players: [{ name: 'J. Tatum', starter: true, dnp: false, stats: ['40', '28', '9', '5'] }],
  },
];

describe('BoxscoreTab', () => {
  it('renders one table per team with the team name and column labels', () => {
    render(<BoxscoreTab tables={tables} />);
    expect(screen.getByText('Los Angeles Lakers')).toBeInTheDocument();
    expect(screen.getByText('Boston Celtics')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getAllByText('PTS').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a player row with its stats', () => {
    render(<BoxscoreTab tables={tables} />);
    expect(screen.getByText('L. James')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('J. Tatum')).toBeInTheDocument();
  });

  it('renders a DNP player without crashing on empty stats', () => {
    render(<BoxscoreTab tables={tables} />);
    const row = screen.getByText('B. Reserve').closest('tr');
    expect(row).not.toBeNull();
    // DNP marker text is present in the row
    expect(within(row as HTMLElement).getByText('DNP')).toBeInTheDocument();
  });

  it('shows an empty message when there are no tables', () => {
    render(<BoxscoreTab tables={[]} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
