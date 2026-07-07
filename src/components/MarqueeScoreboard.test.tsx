import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { CompMatch } from '../types';
import MarqueeScoreboard from './MarqueeScoreboard';

function m(id: string, status: CompMatch['status'], kickoff: Date | null): CompMatch {
  return {
    id,
    homeName: 'Mexico',
    awayName: 'Brazil',
    homeFlag: 'mex.png',
    awayFlag: 'bra.png',
    homeId: `h${id}`,
    awayId: `a${id}`,
    homeScore: status === 'upcoming' ? null : 2,
    awayScore: status === 'upcoming' ? null : 1,
    kickoff,
    status,
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: `mexico-vs-brazil-${id}`,
  };
}

function renderBar(matches: CompMatch[]) {
  return render(
    <LanguageProvider>
      <MarqueeScoreboard matches={matches} comp="fifa.world" />
    </LanguageProvider>,
  );
}

describe('MarqueeScoreboard', () => {
  it('renders nothing when there are no bar-worthy matches', () => {
    const { container } = renderBar([m('old', 'finished', new Date('2020-01-01T00:00:00Z'))]);
    expect(container.firstChild).toBeNull();
  });

  it('renders a live match chip and navigates to its detail on click', () => {
    const spy = vi.spyOn(window.history, 'pushState');
    // kickoff = now-ish so it counts as today/live
    renderBar([m('L', 'live', new Date())]);
    // Two team crests render (chips duplicate the track for seamless scroll,
    // so query all and assert at least one)
    expect(screen.getAllByAltText('Mexico').length).toBeGreaterThan(0);
    const chip = screen.getAllByRole('button', { name: /Mexico.*Brazil/ })[0];
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalledWith(null, '', '/fifa.world/match/mexico-vs-brazil-L');
    spy.mockRestore();
  });
});
