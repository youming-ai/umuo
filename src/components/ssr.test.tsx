// @vitest-environment node
// The content islands render on the server (client:load), so they must produce
// real HTML without touching window/document — and must produce it identically
// on both sides, since a hydration mismatch throws the SSR markup away. Node
// environment on purpose: `document` is undefined here, exactly like workerd.
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SITE_NAME } from '../site';
import ExploreView from './explore/ExploreView';

it('renders the Explore shell server-side without touching browser globals', () => {
  const html = renderToString(
    <ExploreView
      initialData={{ items: [], nextCursor: null }}
      initialFilters={{ categories: [] }}
    />,
  );
  expect(html).toContain('⌨️');
  expect(html).toContain(SITE_NAME); // carried by the logo's sr-only span
  expect(html).toContain('Search stories');
  // The theme switcher SSRs as an icon-less button; localStorage stays
  // unread at render time so the hydration pass always agrees.
  expect(html).toContain('aria-label="Theme"');
});

it('renders article cards server-side', () => {
  const html = renderToString(
    <ExploreView
      initialData={{
        items: [
          {
            id: '1',
            title: 'New flagship GPU beats its predecessor',
            description: '',
            summary: 'The new flagship GPU wins every benchmark.',
            blurb: '',
            url: 'https://tomshardware.com/pc-components',
            imageUrl: '',
            imageWidth: 0,
            imageHeight: 0,
            sourceId: 'toms-hardware',
            sourceName: "Tom's Hardware",
            sourceDomain: 'tomshardware.com',
            publishedAt: 1786080856000,
            category: 'gpu',
            articleType: 'review',
            tags: ['gpu'],
            qualityScore: 82,
            freshnessScore: 60,
          },
        ],
        nextCursor: null,
      }}
      initialFilters={{ categories: [] }}
    />,
  );
  expect(html).toContain('New flagship GPU beats its predecessor');
  expect(html).toContain('tomshardware.com');
  expect(html).toContain('review');
});
