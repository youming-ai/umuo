import { describe, expect, it } from 'vitest';
import { isTrustedStreamUrl } from './streamSources';

describe('isTrustedStreamUrl', () => {
  it('accepts HTTPS URLs from trusted stream hosts', () => {
    expect(isTrustedStreamUrl('https://embedindia.st/embed/wc/game')).toBe(true);
    expect(isTrustedStreamUrl('https://live.embedindia.st/embed/wc/game')).toBe(true);
    expect(isTrustedStreamUrl('https://ppv.st/embed/game')).toBe(true);
    expect(isTrustedStreamUrl('https://vileembeds.pages.dev/embed/fox-usa')).toBe(true);
    expect(isTrustedStreamUrl('https://ritzembeds.pages.dev/embed/dirtvision-1')).toBe(true);
  });

  it('rejects non-HTTPS, malformed, and unknown stream URLs', () => {
    expect(isTrustedStreamUrl('http://embedindia.st/embed/wc/game')).toBe(false);
    // seized domain — must stay untrusted
    expect(isTrustedStreamUrl('https://ppv.to/embed/game')).toBe(false);
    // only the pinned project subdomain, never other pages.dev projects
    expect(isTrustedStreamUrl('https://evil.pages.dev/embed')).toBe(false);
    expect(isTrustedStreamUrl('javascript:alert(1)')).toBe(false);
    expect(isTrustedStreamUrl('https://evil.example/embed')).toBe(false);
    expect(isTrustedStreamUrl('not-a-url')).toBe(false);
  });
});
