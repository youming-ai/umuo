import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
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
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    // The whole knockout is one labelled figure (the trophy is decorative).
    expect(screen.getByRole('img', { name: 'Final' })).toBeInTheDocument();
    expect(screen.getByText('🏆')).toBeInTheDocument();
  });

  it('shows TBD in the 3rd-place chip before any team has qualified', () => {
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    // With no data every rim slot is a quiet waypoint dot; the only visible
    // copy is the 3rd-place chip's two TBD placeholders.
    expect(screen.getAllByText('TBD')).toHaveLength(2);
  });

  it('resolves R32 place slots from standings', () => {
    const groups: WCGroup[] = [
      group('A', [standing({ teamId: '203', name: 'Mexico', pts: 9 })]),
      group('B', [standing({ teamId: '224', name: 'Canada', pts: 6 })]),
    ];
    render(
      <LanguageProvider>
        <BracketView groups={groups} matches={[]} />
      </LanguageProvider>,
    );
    // Mexico wins group A (1A slot, M79) and Canada group B (1B slot, M85).
    expect(screen.getAllByLabelText('Mexico').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Canada').length).toBeGreaterThan(0);
  });

  it('shows crests, with the country name as the accessible label, not visible copy', () => {
    render(
      <LanguageProvider>
        <BracketView
          groups={[
            group('A', [standing({ teamId: '203', name: 'Mexico', flag: 'mex.png', pts: 9 })]),
          ]}
          matches={[]}
        />
      </LanguageProvider>,
    );
    // Name reaches assistive tech via the node's label...
    expect(screen.getAllByLabelText('Mexico').length).toBeGreaterThan(0);
    // ...but is never rendered as visible text on the disc.
    expect(screen.queryByText('Mexico')).not.toBeInTheDocument();
  });

  it('does not navigate from a slot that has no match attached', () => {
    const spy = vi.spyOn(window.history, 'pushState');
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    // The 3rd-place chip is the one always-present control; with no data it is
    // disabled and clicking it is a no-op.
    const chip = screen.getByRole('button');
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(spy).not.toHaveBeenCalled();
  });
});
