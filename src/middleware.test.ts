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
  it('passes the root through to the global home', () => {
    const { next, redirect } = run(`${O}/`);
    expect(next).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects the legacy Explore route to the global home', () => {
    expect(run(`${O}/explore`).redirect).toHaveBeenCalledWith('/', 308);
    expect(run(`${O}/explore/?q=transfer`).redirect).toHaveBeenCalledWith('/?q=transfer', 308);
  });

  it('redirects removed World Cup paths to the global home', () => {
    expect(run(`${O}/fifa.world/schedule`).redirect).toHaveBeenCalledWith('/', 307);
    expect(run(`${O}/fifa.world`).redirect).toHaveBeenCalledWith('/', 307);
    expect(run(`${O}/fifa.world/news`).redirect).toHaveBeenCalledWith('/', 307);
  });

  it('redirects a comp news path to its hub', () => {
    expect(run(`${O}/eng.1/news`).redirect).toHaveBeenCalledWith('/eng.1', 307);
    expect(run(`${O}/nba/news`).redirect).toHaveBeenCalledWith('/nba', 307);
  });

  it('redirects a removed bracket path to the comp hub', () => {
    expect(run(`${O}/eng.1/bracket`).redirect).toHaveBeenCalledWith('/eng.1', 307);
  });

  it('collapses trailing-slash legacy paths to the hub', () => {
    expect(run(`${O}/eng.1/news/`).redirect).toHaveBeenCalledWith('/eng.1', 307);
    expect(run(`${O}/nba/bracket/`).redirect).toHaveBeenCalledWith('/nba', 307);
    expect(run(`${O}/eng.1/news/?ref=a`).redirect).toHaveBeenCalledWith('/eng.1?ref=a', 307);
  });

  it('redirects legacy /news paths to the default competition hub', () => {
    expect(run(`${O}/news`).redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}`, 307);
    expect(run(`${O}/news/soccer`).redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}`, 307);
  });

  it('redirects legacy unprefixed /bracket path directly to default competition hub in 1 hop', () => {
    const { redirect } = run(`${O}/bracket`);
    expect(redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}`, 307);
  });

  it('redirects legacy unprefixed paths to the default competition', () => {
    const { redirect } = run(`${O}/schedule`);
    expect(redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}/schedule`, 307);
  });

  it('redirects the legacy /scorers slug to /stats (unprefixed and comp-scoped)', () => {
    expect(run(`${O}/scorers`).redirect).toHaveBeenCalledWith(`/${DEFAULT_COMPETITION}/stats`, 307);
    expect(run(`${O}/eng.1/scorers`).redirect).toHaveBeenCalledWith(`/eng.1/stats`, 307);
    expect(run(`${O}/eng.1/scorers`).redirect).toHaveBeenCalledWith(`/eng.1/stats`, 307);
  });

  it('preserves the query string across redirects', () => {
    expect(run(`${O}/fifa.world/x?ref=a`).redirect).toHaveBeenCalledWith('/?ref=a', 307);
    expect(run(`${O}/eng.1/news?ref=share`).redirect).toHaveBeenCalledWith('/eng.1?ref=share', 307);
    expect(run(`${O}/match/foo?ref=share`).redirect).toHaveBeenCalledWith(
      `/${DEFAULT_COMPETITION}/match/foo?ref=share`,
      307,
    );
  });

  it('passes through /api, root, and comp-prefixed routes', () => {
    for (const p of [
      '/api',
      '/api/eng.1/scoreboard',
      '/',
      `/${DEFAULT_COMPETITION}`,
      `/${DEFAULT_COMPETITION}/schedule`,
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
