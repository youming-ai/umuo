import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewsView from './NewsView';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const feed = {
  articles: [
    {
      id: 7,
      headline: 'Big trade',
      description: 'A summary',
      published: '2026-07-07T00:00:00Z',
      byline: 'ESPN',
      images: [{ url: 'https://a.espncdn.com/x.jpg' }],
      links: { web: { href: 'https://www.espn.com/story/7' } },
      categories: [{ type: 'team', description: 'Lakers', team: { abbreviation: 'LAL' } }],
    },
  ],
};

function renderView() {
  return render(<NewsView comp="nba" />);
}

describe('NewsView', () => {
  it('renders headlines with an external link and a plain team tag', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => feed });
    renderView();
    await waitFor(() => expect(screen.getByText('Big trade')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /Big trade/ });
    expect(link).toHaveAttribute('href', 'https://www.espn.com/story/7');
    expect(link).toHaveAttribute('target', '_blank');
    // tags are plain labels now — news is per-competition, no entity-scoped route
    expect(screen.getByText('Lakers')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lakers' })).not.toBeInTheDocument();
  });

  it('shows the empty message when there are no headlines', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) });
    renderView();
    await waitFor(() => expect(screen.getByText('No news right now')).toBeInTheDocument());
  });

  it('renders a non-link card when the article url is missing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        articles: [
          {
            id: 9,
            headline: 'No link here',
            description: 'd',
            published: '2026-07-07T00:00:00Z',
            byline: 'ESPN',
            images: [],
            links: {},
            categories: [],
          },
        ],
      }),
    });
    renderView();
    await waitFor(() => expect(screen.getByText('No link here')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /No link here/ })).not.toBeInTheDocument();
  });
});
