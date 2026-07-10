import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WCGroup } from '../types';
import BracketView from './BracketView';

function standing(overrides: {
  teamId: string;
  name: string;
  flag?: string;
  pts?: number;
  gd?: number;
  gf?: number;
}) {
  return {
    teamId: overrides.teamId,
    name: overrides.name,
    flag: overrides.flag ?? '',
    mp: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: overrides.gf ?? 0,
    ga: 0,
    gd: overrides.gd ?? 0,
    pts: overrides.pts ?? 0,
  };
}

function group(letter: string, teams: ReturnType<typeof standing>[]): WCGroup {
  return { name: letter, standings: teams };
}

describe('BracketView', () => {
  it('renders the radial disc with the cup at its centre', () => {
    render(<BracketView groups={[]} matches={[]} />);
    // The whole knockout is one labelled figure (the trophy is decorative).
    expect(screen.getByRole('img', { name: 'Tournament bracket' })).toBeInTheDocument();
    expect(screen.getByText('🏆')).toBeInTheDocument();
  });

  it('shows TBD in the 3rd-place chip before any team has qualified', () => {
    render(<BracketView groups={[]} matches={[]} />);
    // With no data every rim slot is a quiet waypoint dot; the only visible
    // copy is the 3rd-place chip's two TBD placeholders.
    expect(screen.getAllByText('TBD')).toHaveLength(2);
  });

  it('resolves R32 place slots from standings', () => {
    const groups: WCGroup[] = [
      group('A', [standing({ teamId: '203', name: 'Mexico', pts: 9 })]),
      group('B', [standing({ teamId: '224', name: 'Canada', pts: 6 })]),
    ];
    render(<BracketView groups={groups} matches={[]} />);
    // Mexico wins group A (1A slot, M79) and Canada group B (1B slot, M85).
    expect(screen.getAllByLabelText('Mexico').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Canada').length).toBeGreaterThan(0);
  });

  it('shows crests, with the country name as the accessible label, not visible copy', () => {
    render(
      <BracketView
        groups={[
          group('A', [standing({ teamId: '203', name: 'Mexico', flag: 'mex.png', pts: 9 })]),
        ]}
        matches={[]}
      />,
    );
    // Name reaches assistive tech via the node's label...
    expect(screen.getAllByLabelText('Mexico').length).toBeGreaterThan(0);
    // ...but is never rendered as visible text on the disc.
    expect(screen.queryByText('Mexico')).not.toBeInTheDocument();
  });

  it('renders the empty 3rd-place chip without a link when no match is attached', () => {
    render(<BracketView groups={[]} matches={[]} />);
    // Empty data: no match links on the disc or chip (TBD slots are non-links).
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('3rd place').closest('[aria-disabled="true"]')).toBeTruthy();
  });
});
