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
  it('renders the symmetric round columns (both sides + Final + 3rd)', () => {
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    // Symmetric layout: R32/R16/QF/SF each appear on both sides (8 headers)
    // + the central Final (1) + the 3rd-place heading (1) → 10 headers.
    const headers = screen.getAllByRole('heading', { level: 3 });
    expect(headers).toHaveLength(10);
  });

  it('renders TBD placeholders for all slots when no data is provided', () => {
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    // Each TBD cell has at least 2 'TBD' placeholders (home + away), so
    // 30 matches × 2 = 60. Use a generous count to allow for exact-text
    // matching — any cell has at least 2 TBDs.
    const tbd = screen.getAllByText('TBD');
    expect(tbd.length).toBeGreaterThanOrEqual(60);
  });

  it('resolves R32 place slots from standings (1A, 2B, 3rd place)', () => {
    const groups: WCGroup[] = [
      group('A', [standing({ teamId: '203', name: 'Mexico', pts: 9 })]),
      group('B', [standing({ teamId: '224', name: 'Canada', pts: 6 })]),
    ];
    render(
      <LanguageProvider>
        <BracketView groups={groups} matches={[]} />
      </LanguageProvider>,
    );
    // M73 = 2A vs 2B → Mexico (1st) appears in the 1A slot (M79), and
    // Canada (1st) appears in the 1B slot (M85). For the M73 row
    // (2A vs 2B), the standings haven't filled in runners-up yet, so
    // TBD is expected.
    // Verify that 1A and 1B cells (M79 / M85) are filled.
    expect(screen.getAllByText('Mexico').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Canada').length).toBeGreaterThan(0);
  });

  it('shows flags only — the country name is in the crest alt text, not visible copy', () => {
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
    // Crest carries the country name as accessible alt text...
    expect(screen.getAllByAltText('Mexico').length).toBeGreaterThan(0);
    // ...but the name is NOT rendered as visible text (flags-only bracket).
    expect(screen.queryByText('Mexico')).not.toBeInTheDocument();
  });

  it('renders match labels (M73, M89, M104) correctly', () => {
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    // Flags-only cells: the M-label is the button's accessible name, not visible text.
    expect(screen.getByRole('button', { name: 'M73' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M89' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M104' })).toBeInTheDocument();
  });

  it('does not navigate on cell click when no CompMatch is attached', () => {
    // jsdom's window.location is read-only; just verify clicking a TBD
    // cell doesn't crash and the click handler is a no-op.
    const spy = vi.spyOn(window.history, 'pushState');
    render(
      <LanguageProvider>
        <BracketView groups={[]} matches={[]} />
      </LanguageProvider>,
    );
    const firstButton = screen.getAllByRole('button')[0];
    expect(firstButton).toBeDisabled();
    fireEvent.click(firstButton);
    expect(spy).not.toHaveBeenCalled();
  });
});
