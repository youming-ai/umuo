import { describe, expect, it, vi } from 'vitest';
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

  it('passes everything else through untouched', () => {
    for (const path of ['/eng.1', '/eng.1/', '/news', '/fifa.world/schedule', '/scorers']) {
      const { next, redirect } = run(`${O}${path}`);
      expect(next).toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    }
  });
});
