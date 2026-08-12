// @vitest-environment node
// The content islands render on the server (client:load), so they must produce
// real HTML without touching window/document — and must produce it identically
// on both sides, since a hydration mismatch throws the SSR markup away. Node
// environment on purpose: `document` is undefined here, exactly like workerd.
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import ExploreView from './explore/ExploreView';

// The Explore bar carries the brand mark and the theme switcher, and the whole
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
  expect(html).toContain('⚽');
  expect(html).toContain('umu');
  expect(html).toContain('Search stories');
  // The search magnifier is an intentional SSR icon (static, theme-neutral).
  // The theme switcher must NOT guess a theme on the server — an icon in its
  // button would mean it read localStorage during SSR, which would mismatch
  // on hydration. Scope the guard to the switcher's aria-label.
  expect(html).not.toMatch(/<button[^>]*aria-label="[^"]*theme[^"]*"[\s\S]*?<svg/i);
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
