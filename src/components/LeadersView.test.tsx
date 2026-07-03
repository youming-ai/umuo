import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { Leader } from '../types';
import LeadersView from './LeadersView';

function renderView(
  leaders: Leader[],
  statLabelKey = 'scorers.goals',
  empty = 'No goals scored yet',
  titleKey?: string,
  subtitleKey?: string,
) {
  return render(
    <LanguageProvider>
      <LeadersView
        leaders={leaders}
        statLabelKey={statLabelKey}
        titleKey={titleKey}
        subtitleKey={subtitleKey}
        empty={empty}
      />
    </LanguageProvider>,
  );
}

const rows: Leader[] = [
  {
    rank: 1,
    name: 'Erling Haaland',
    teamName: 'Norway',
    teamLogo: '',
    displayValue: '4',
    value: 4,
  },
  { rank: 2, name: 'Kylian Mbappé', teamName: 'France', teamLogo: '', displayValue: '3', value: 3 },
  { rank: 3, name: 'Mohamed Salah', teamName: 'Egypt', teamLogo: '', displayValue: '2', value: 2 },
];

describe('LeadersView', () => {
  it('shows the provided empty message when there are no leaders', () => {
    renderView([], 'scorers.goals', 'No goals scored yet');
    expect(screen.getByText('No goals scored yet')).toBeInTheDocument();
  });

  it('renders each leader with rank, name, team, and displayValue', () => {
    renderView(rows);
    expect(screen.getByText('Erling Haaland')).toBeInTheDocument();
    expect(screen.getByText('Kylian Mbappé')).toBeInTheDocument();
    expect(screen.getByText('Mohamed Salah')).toBeInTheDocument();
    expect(screen.getAllByText('Norway').length).toBeGreaterThan(0);
    expect(screen.getAllByText('France').length).toBeGreaterThan(0);
    // The value cell shows displayValue in a bold tabular cell.
    const valueCells = screen.getAllByRole('cell').filter((c) => c.className.includes('font-bold'));
    expect(valueCells.map((c) => c.textContent)).toEqual(['4', '3', '2']);
  });

  it('numbers rows from the Leader.rank field', () => {
    renderView(rows);
    const trs = screen.getAllByRole('row');
    // trs[0] = header row, trs[1..] = leader rows
    expect(trs[1]?.textContent).toMatch(/^1/);
    expect(trs[2]?.textContent).toMatch(/^2/);
  });

  it('renders the column header from statLabelKey (basketball → PTS)', () => {
    renderView(rows, 'leaders.points', 'No stats yet');
    expect(screen.getByRole('columnheader', { name: 'PTS' })).toBeInTheDocument();
  });

  it('renders no clickable rows (no buttons or links)', () => {
    renderView(rows);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('defaults to the soccer title/subtitle when titleKey/subtitleKey are omitted', () => {
    renderView(rows);
    // Title renders twice (visible heading + sr-only <caption>).
    expect(screen.getAllByText('Top Scorers').length).toBeGreaterThan(0);
    expect(screen.getByText('Golden Boot race')).toBeInTheDocument();
  });

  it('renders the passed titleKey/subtitleKey (basketball → Scoring Leaders)', () => {
    renderView(rows, 'leaders.points', 'No stats yet', 'leaders.title', 'leaders.subtitle');
    expect(screen.getAllByText('Scoring Leaders').length).toBeGreaterThan(0);
    expect(screen.getByText("Points per the season's top scorers")).toBeInTheDocument();
    expect(screen.queryByText('Top Scorers')).not.toBeInTheDocument();
  });
});
