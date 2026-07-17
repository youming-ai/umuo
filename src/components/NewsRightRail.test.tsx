import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NewsItem } from '../types';
import NewsRightRail from './NewsRightRail';

function item(link: string, headline = 'Headline'): NewsItem {
  return {
    id: 'x',
    headline,
    description: '',
    published: '',
    byline: '',
    imageUrl: '',
    link,
    tags: [],
  };
}

describe('NewsRightRail', () => {
  it('renders an external https link with target=_blank + rel', () => {
    render(<NewsRightRail trending={[item('https://www.espn.com/s/1', 'External')]} scores={[]} />);
    const link = screen.getByRole('link', { name: 'External' });
    expect(link).toHaveAttribute('href', 'https://www.espn.com/s/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders a same-origin / link without target', () => {
    render(<NewsRightRail trending={[item('/fifa.world/news', 'Internal')]} scores={[]} />);
    const link = screen.getByRole('link', { name: 'Internal' });
    expect(link).toHaveAttribute('href', '/fifa.world/news');
    expect(link).not.toHaveAttribute('target');
  });

  // Defense-in-depth: a javascript:/data: URL from the feed must NOT become a
  // clickable anchor (XSS vector). It degrades to a non-clickable span, same
  // guard as NewsView. Mirrors the contract in NewsView's link rendering.
  it('does NOT render a clickable anchor for javascript:/data: URLs', () => {
    render(
      <NewsRightRail
        trending={[
          item('javascript:alert(1)', 'Malicious'),
          item('data:text/html,<script>1</script>', 'DataUrl'),
        ]}
        scores={[]}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // Headlines still render as plain text, just not clickable.
    expect(screen.getByText('Malicious')).toBeInTheDocument();
    expect(screen.getByText('DataUrl')).toBeInTheDocument();
  });
});
