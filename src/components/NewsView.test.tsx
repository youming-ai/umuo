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

  it('initially renders only PAGE_SIZE items and shows the sentinel when there are more', async () => {
    const articles = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      headline: `Story ${i + 1}`,
      description: `Desc ${i + 1}`,
      published: '2026-07-07T00:00:00Z',
      byline: 'ESPN',
      images: [],
      links: { web: { href: `https://www.espn.com/story/${i + 1}` } },
      categories: [],
    }));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ articles }) });
    // jsdom has no IntersectionObserver — stub it so the ref callback doesn't throw
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(() => ({ observe, disconnect, unobserve: vi.fn() })),
    );
    renderView();
    await waitFor(() => expect(screen.getByText('Story 1')).toBeInTheDocument());
    // PAGE_SIZE = 12: lead (Story 1) + 11 story cards (Story 2–12)
    expect(screen.getByText('Story 12')).toBeInTheDocument();
    expect(screen.queryByText('Story 13')).not.toBeInTheDocument();
    // Sentinel is visible because there are more items
    expect(screen.getByText('Loading more…')).toBeInTheDocument();
  });
});
