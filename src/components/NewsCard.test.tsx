import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NewsItem } from '../types';
import NewsCard from './NewsCard';

function item(over: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'a1',
    headline: 'Headline',
    description: '',
    published: '',
    byline: '',
    imageUrl: '',
    link: 'https://www.espn.com/s/1',
    tags: [{ kind: 'league', label: 'Premier League' }],
    ...over,
  };
}

describe('NewsCard', () => {
  it('keeps the tag row out of the anchor so tags stay non-interactive', () => {
    render(<NewsCard item={item()} variant="lead" />);
    const link = screen.getByRole('link');
    expect(link).not.toHaveTextContent('Premier League');
    expect(screen.getByText('Premier League')).toBeInTheDocument();
  });

  // The lead card is a md+ 50/50 split and the tag row lives outside the
  // anchor, so it cannot inherit the text column's position — it has to mirror
  // it. With an image the column is the right half; without one it starts at
  // the left edge. Asserted on classes because jsdom has no layout engine; the
  // with-image geometry is verified in a real browser.
  it('mirrors the lead text column: right half with an image, left without', () => {
    const { container, rerender } = render(
      <NewsCard item={item({ imageUrl: 'https://cdn/x.jpg' })} variant="lead" />,
    );
    const withImage = container.querySelector('div.flex-wrap');
    expect(withImage?.className).toContain('md:w-1/2');
    expect(withImage?.className).toContain('md:ml-auto');

    rerender(<NewsCard item={item({ imageUrl: '' })} variant="lead" />);
    const noImage = container.querySelector('div.flex-wrap');
    expect(noImage?.className).toContain('md:w-1/2');
    expect(noImage?.className).not.toContain('md:ml-auto');
  });

  it('leaves the standard card tag row full width', () => {
    const { container } = render(<NewsCard item={item()} variant="standard" />);
    const tags = container.querySelector('div.flex-wrap');
    expect(tags?.className).not.toContain('md:w-1/2');
    expect(tags?.className).not.toContain('md:ml-auto');
  });

  it('renders no tag row on the compact row variant', () => {
    render(<NewsCard item={item()} variant="row" />);
    expect(screen.queryByText('Premier League')).not.toBeInTheDocument();
  });
});
