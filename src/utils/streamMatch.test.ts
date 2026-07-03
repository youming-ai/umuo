import { describe, expect, it } from 'vitest';
import type { CompMatch, Match } from '../types';
import { indexStreams, isStreamLive, liveStreamForMatch, streamForMatch } from './streamMatch';

function wc(partial: Partial<CompMatch> = {}): CompMatch {
  return {
    id: '760488',
    homeName: 'Netherlands',
    awayName: 'Morocco',
    homeFlag: '',
    awayFlag: '',
    homeId: '1',
    awayId: '2',
    homeScore: null,
    awayScore: null,
    group: '',
    kickoff: null,
    status: 'live',
    stage: 'r16',
    homeScorers: [],
    awayScorers: [],
    venue: '',
    slug: 'netherlands-vs-morocco-760488',
    ...partial,
  };
}
function stream(partial: Partial<Match> = {}): Match {
  return {
    id: 1,
    name: 'Netherlands vs. Morocco',
    category_name: 'Football',
    iframe: 'https://x',
    viewers: '0',
    substreams: [],
    slug: 'netherlands-vs-morocco',
    ...partial,
  };
}

describe('streamForMatch', () => {
  it('matches a ppv stream to an ESPN fixture by team-name slug', () => {
    const s = stream();
    expect(streamForMatch(wc(), indexStreams([s]))).toBe(s);
  });

  it('matches when the stream lists the teams in reverse order', () => {
    const s = stream({ slug: 'morocco-vs-netherlands' });
    expect(streamForMatch(wc(), indexStreams([s]))).toBe(s);
  });

  it('returns null when no stream matches', () => {
    expect(streamForMatch(wc(), indexStreams([stream({ slug: 'france-vs-sweden' })]))).toBeNull();
  });

  it('never matches a finished fixture (avoids tagging the played leg of a rematch)', () => {
    // Same two teams meet twice; the live stream is for the later leg. The
    // already-finished earlier leg must not resolve to it.
    expect(streamForMatch(wc({ status: 'finished' }), indexStreams([stream()]))).toBeNull();
  });

  it('bridges provider name variants (Türkiye↔Turkey, United States↔USA)', () => {
    const s = stream({ slug: 'turkey-vs-usa' });
    const m = wc({ homeName: 'Türkiye', awayName: 'United States' });
    expect(streamForMatch(m, indexStreams([s]))).toBe(s);
  });
});

describe('isStreamLive', () => {
  const now = 1_700_000_000_000; // fixed ms

  it('is live for alwaysLive streams regardless of window', () => {
    expect(isStreamLive(stream({ alwaysLive: true }), now)).toBe(true);
  });

  it('is not live before startsAt', () => {
    expect(isStreamLive(stream({ startsAt: now / 1000 + 3600 }), now)).toBe(false);
  });

  it('is not live at/after endsAt', () => {
    expect(isStreamLive(stream({ endsAt: now / 1000 - 3600 }), now)).toBe(false);
  });

  it('is live within the [startsAt, endsAt) window', () => {
    expect(
      isStreamLive(stream({ startsAt: now / 1000 - 60, endsAt: now / 1000 + 3600 }), now),
    ).toBe(true);
  });

  it('treats an endsAt of 0 as a real (1970) boundary, not "no value"', () => {
    expect(isStreamLive(stream({ endsAt: 0 }), now)).toBe(false);
  });
});

describe('liveStreamForMatch', () => {
  const now = 1_700_000_000_000;

  it('returns the matched stream when it is live', () => {
    const s = stream({ alwaysLive: true });
    expect(liveStreamForMatch(wc(), indexStreams([s]), now)).toBe(s);
  });

  it('returns null when the matched stream is not live yet', () => {
    const s = stream({ startsAt: now / 1000 + 3600 });
    expect(liveStreamForMatch(wc(), indexStreams([s]), now)).toBeNull();
  });

  it('returns null for a finished fixture even with a live stream', () => {
    const s = stream({ alwaysLive: true });
    expect(liveStreamForMatch(wc({ status: 'finished' }), indexStreams([s]), now)).toBeNull();
  });
});
