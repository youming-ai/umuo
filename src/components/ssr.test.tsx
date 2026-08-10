// @vitest-environment node
// The content islands render on the server (client:load), so they must produce
// real HTML without touching window/document — and must produce it identically
// on both sides, since a hydration mismatch throws the SSR markup away. Node
// environment on purpose: `document` is undefined here, exactly like workerd.
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import ExploreView from './explore/ExploreView';

// The Explore bar carries the wordmark and the theme switcher, and the whole
// island is SSR'd via client:load. ThemeSwitcher therefore must not read
// localStorage during render — there is no `window` here, exactly like workerd,
// and a differing first client render would throw the SSR markup away.
it('renders the Explore shell server-side without touching browser globals', () => {
  const html = renderToString(
    <ExploreView
      initialData={{ items: [], nextCursor: null }}
      initialFilters={{ competitions: [], sources: [], tags: [] }}
    />,
  );
  expect(html).toContain('umu');
  expect(html).toContain('Search stories');
  // Icon-less until mount: an icon in the SSR markup would mean the switcher
  // guessed a theme on the server.
  expect(html).not.toContain('<svg');
});

it('renders article cards server-side', () => {
  const html = renderToString(
    <ExploreView
      initialData={{
        items: [
          {
            id: '1',
            title: 'Arsenal beat Chelsea',
            description: '',
            summary: 'A late winner at the Emirates.',
            blurb: '',
            url: 'https://bbc.com/sport',
            imageUrl: '',
            sourceId: 'bbc',
            sourceName: 'BBC Sport',
            sourceDomain: 'bbc.com',
            publishedAt: 1786080856000,
            competition: 'eng.1',
            articleType: 'match-report',
            tags: ['premier-league'],
            qualityScore: 82,
            freshnessScore: 60,
          },
        ],
        nextCursor: null,
      }}
      initialFilters={{ competitions: [], sources: [], tags: [] }}
    />,
  );
  expect(html).toContain('Arsenal beat Chelsea');
  expect(html).toContain('bbc.com');
  expect(html).toContain('match report');
});
