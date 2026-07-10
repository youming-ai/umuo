import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StandingsData } from '../adapters/types';
import RightRail from './RightRail';

const emptyStandings: StandingsData = { kind: 'soccer', groups: [] };

describe('RightRail standings states', () => {
  it('shows a loading state while empty standings are being fetched', () => {
    render(
      <RightRail comp="fifa.world" standings={emptyStandings} scorers={[]} standingsLoading />,
    );

    expect(screen.getByText('Loading standings…')).toBeInTheDocument();
    expect(screen.queryByText('No standings yet.')).not.toBeInTheDocument();
  });

  it('shows a retryable error when empty standings fail to load', () => {
    const retry = vi.fn();
    render(
      <RightRail
        comp="fifa.world"
        standings={emptyStandings}
        scorers={[]}
        standingsError="Failed to load standings"
        onStandingsRetry={retry}
      />,
    );

    expect(screen.getByText('Failed to load standings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
