import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPETITION } from './competitions';
import { onRequest } from './middleware';

// Minimal harness: capture redirect() targets and whether next() ran.
function run(url: string) {
  const redirect = vi.fn(
    (to: string, status?: number) => new Response(null, { status, headers: { location: to } }),
  );
  const next = vi.fn(() => new Response('ok'));
  onRequest({ request: new Request(url), redirect, url: new URL(url) }, next);
  return { redirect, next };
}

const O = 'https://x.test';

describe('middleware routing', () => {
  it('redirects root to the default competition news', () => {
    const { redirect } = run(`${O}/`);
    expect(redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}/news`, 307);
  });

  it('redirects legacy /news paths to the default competition news', () => {
    expect(run(`${O}/news`).redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}/news`, 307);
    expect(run(`${O}/news/soccer`).redirect).toHaveBeenCalledWith(
      `/${DEFAULT_COMPETITION}/news`,
      307,
    );
  });

  it('redirects legacy unprefixed paths to the default competition', () => {
    const { redirect } = run(`${O}/scorers`);
    expect(redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}/scorers`, 307);
  });

  it('preserves the query string across redirects', () => {
    expect(run(`${O}/?ref=a`).redirect).toHaveBeenCalledWith(
      `/${DEFAULT_COMPETITION}/news?ref=a`,
      307,
    );
    expect(run(`${O}/match/foo?ref=share`).redirect).toHaveBeenCalledWith(
      `/${DEFAULT_COMPETITION}/match/foo?ref=share`,
      307,
    );
  });

  it('passes through /api and comp-prefixed routes', () => {
    for (const p of [
      '/api',
      '/api/fifa.world/scoreboard',
      `/${DEFAULT_COMPETITION}`,
      `/${DEFAULT_COMPETITION}/news`,
    ]) {
      const { next, redirect } = run(`${O}${p}`);
      expect(next, p).toHaveBeenCalled();
      expect(redirect, p).not.toHaveBeenCalled();
    }
  });

  it('passes through file-like paths (assets) so missing files 404 cleanly, not redirect', () => {
    for (const p of ['/favicon.png', '/sw.js', '/manifest.webmanifest', '/robots.txt']) {
      const { next, redirect } = run(`${O}${p}`);
      expect(next, p).toHaveBeenCalled();
      expect(redirect, p).not.toHaveBeenCalled();
    }
  });
});
