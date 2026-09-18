import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExploreArticle } from '../types';
import ExploreCard from './explore/ExploreCard';

// The card's video preview is the one place the app animates without the reader
// asking. Two behaviours need pinning and neither is visible in SSR markup:
// playback is started from the effect (never from a rendered `autoplay`, which
// can fire before hydration), and a reduced-motion reader is left paused on a
// loaded first frame rather than on an empty box.

const video: ExploreArticle = {
  id: 'v1',
  title: 'Launch film',
  description: '',
  summary: '',
  blurb: '',
  url: 'https://o.doubao.com/',
  imageUrl: 'https://cdn.example.com/hero_1080p_video.mp4',
  isVideo: true,
  imageWidth: 0,
  imageHeight: 0,
  sourceDomain: 'o.doubao.com',
  publishedAt: 1789434835000,
  category: 'tools',
  tags: ['tools'],
  qualityScore: 90,
  freshnessScore: 100,
};

/** jsdom implements neither playback nor matchMedia; both are stubbed per test. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    flip(next: boolean) {
      Object.defineProperty(query, 'matches', { value: next, configurable: true });
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function stubPlayback() {
  const play = vi.fn(async () => {});
  const pause = vi.fn();
  const load = vi.fn();
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: play,
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: pause,
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: load,
  });
  return { play, pause, load };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ExploreCard video preview', () => {
  it('never renders an autoplay attribute, and starts playback from the effect', () => {
    stubMatchMedia(false);
    const { play } = stubPlayback();
    const { container } = render(<ExploreCard article={video} />);

    const element = container.querySelector('video');
    expect(element).not.toBeNull();
    // A rendered attribute would start the loop before this island hydrates.
    expect(element!.hasAttribute('autoplay')).toBe(false);
    expect(play).toHaveBeenCalledOnce();
  });

  it('leaves a reduced-motion reader paused on a loaded frame', () => {
    stubMatchMedia(true);
    const { play, pause, load } = stubPlayback();
    const { container } = render(<ExploreCard article={video} />);

    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    // preload="none" would leave the paused video with nothing to paint.
    expect(load).toHaveBeenCalled();
    expect(container.querySelector('video')!.getAttribute('preload')).toBe('metadata');
  });

  it('follows a preference change while the page is open', () => {
    const media = stubMatchMedia(true);
    const { play } = stubPlayback();
    render(<ExploreCard article={video} />);
    expect(play).not.toHaveBeenCalled();

    media.flip(false);
    expect(play).toHaveBeenCalledOnce();
  });

  it('unsubscribes from the media query on unmount', () => {
    const media = stubMatchMedia(false);
    stubPlayback();
    const { unmount } = render(<ExploreCard article={video} />);
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
