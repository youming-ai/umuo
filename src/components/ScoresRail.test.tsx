import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TickerMatch } from '../hooks/useTicker';
import ScoresRail from './ScoresRail';

function match(over: Partial<TickerMatch> = {}): TickerMatch {
  return {
    id: '1',
    comp: 'eng.1',
    slug: 'arsenal-vs-chelsea-1',
    homeName: 'Arsenal',
    awayName: 'Chelsea',
    homeFlag: '',
    awayFlag: '',
    homeId: '1',
    awayId: '2',
    homeScore: 2,
    awayScore: 1,
    kickoff: null,
    status: 'finished',
    homeScorers: [],
    awayScorers: [],
    ...over,
  } as TickerMatch;
}

describe('ScoresRail', () => {
  it('links each score to its match page and labels the competition', () => {
    render(<ScoresRail scores={[match()]} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/eng.1/match/arsenal-vs-chelsea-1');
    expect(screen.getByText('Premier League')).toBeInTheDocument();
  });

  // Empty-while-loading and empty-because-nothing-is-on are different states;
  // the rail must not report "no matches" before the first poll resolves.
  it('distinguishes the loading empty state from the settled empty state', () => {
    const { rerender } = render(<ScoresRail scores={[]} loading />);
    expect(screen.getByText('Loading scores...')).toBeInTheDocument();

    rerender(<ScoresRail scores={[]} />);
    expect(screen.getByText('No matches right now.')).toBeInTheDocument();
  });
});
