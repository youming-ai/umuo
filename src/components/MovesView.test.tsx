import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LeagueInjuryGroup, TransactionItem } from '../types';
import MovesView from './MovesView';

describe('MovesView', () => {
  it('renders transactions and injuries', () => {
    const transactions: TransactionItem[] = [
      { date: '2026-07-10', description: 'Signed G John Doe', team: 'Hawks' },
    ];
    const injuries: LeagueInjuryGroup[] = [
      { team: 'Celtics', players: [{ name: 'Kristaps Porzingis', status: 'Out' }] },
    ];
    render(<MovesView transactions={transactions} injuries={injuries} />);
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText(/Signed G John Doe/)).toBeInTheDocument();
    expect(screen.getByText('Hawks:')).toBeInTheDocument();
    expect(screen.getByText('Injuries')).toBeInTheDocument();
    expect(screen.getByText('Celtics')).toBeInTheDocument();
    expect(screen.getByText('Kristaps Porzingis')).toBeInTheDocument();
    expect(screen.getByText('Out')).toBeInTheDocument();
  });

  it('shows empty state when both feeds are empty', () => {
    render(<MovesView transactions={[]} injuries={[]} />);
    expect(screen.getByText('No recent moves.')).toBeInTheDocument();
    expect(screen.queryByText('Transactions')).not.toBeInTheDocument();
  });

  it('shows transactions without injuries section', () => {
    render(
      <MovesView
        transactions={[{ date: '2026-07-10', description: 'Waived F Test', team: '' }]}
        injuries={[]}
      />,
    );
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.queryByText('Injuries')).not.toBeInTheDocument();
  });

  it('shows injuries without transactions section', () => {
    render(
      <MovesView
        transactions={[]}
        injuries={[{ team: 'Lakers', players: [{ name: 'Player X', status: 'Day-To-Day' }] }]}
      />,
    );
    expect(screen.queryByText('Transactions')).not.toBeInTheDocument();
    expect(screen.getByText('Injuries')).toBeInTheDocument();
    expect(screen.getByText('Player X')).toBeInTheDocument();
  });
});
