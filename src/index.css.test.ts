import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Design-token source-of-truth check: design-tokens/tokens.json (the Figma
// import source) must stay in sync with the runtime values in src/index.css.
// The palette drifted once (the dark values diverged silently); this test is
// the CI tripwire so it can't happen again unnoticed.

// cwd-relative: vitest's jsdom environment mangles import.meta.url schemes.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const tokens = JSON.parse(
  readFileSync(resolve(process.cwd(), 'design-tokens/tokens.json'), 'utf8'),
) as {
  color: Record<string, { $value: { dark?: string; light?: string } }>;
};

// tokens.json uses semantic names; index.css uses --c-* vars. This is the
// same bridge tailwind.config.js builds (`c('--c-bg')` → color "night").
const CSS_VAR: Record<string, string> = {
  night: 'bg',
  panel: 'surface',
  panel2: 'surface2',
  line: 'line',
  chalk: 'text',
  chalkdim: 'muted',
  pitch: 'pitch',
  live: 'live',
  amber: 'amber',
  overlay: 'overlay',
  scrim: 'scrim',
  onscrim: 'on-scrim',
  onaccent: 'on-accent',
};

function hexFromChannels(channels: string): string {
  const [r, g, b] = channels
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Extract the `--c-*` channel triplets from one theme block of index.css. */
function cssColorBlock(theme: 'dark' | 'light'): Record<string, string> {
  const selector = theme === 'dark' ? ":root,\n[data-theme='dark']" : "[data-theme='light']";
  const start = css.indexOf(selector);
  expect(start, `${theme} block selector`).toBeGreaterThan(-1);
  const body = css.slice(start + selector.length, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--c-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    out[match[1]] = hexFromChannels(`${match[2]} ${match[3]} ${match[4]}`);
  }
  return out;
}

describe('design tokens', () => {
  const dark = cssColorBlock('dark');
  const light = cssColorBlock('light');

  it('keeps every tokens.json color in sync with index.css (dark + light)', () => {
    for (const [name, token] of Object.entries(tokens.color)) {
      const cssName = CSS_VAR[name];
      expect(cssName, `mapping for ${name}`).toBeDefined();
      if (token.$value.dark) {
        expect(dark[cssName]?.toLowerCase(), `${name} dark`).toBe(token.$value.dark.toLowerCase());
      }
      if (token.$value.light) {
        // Theme-invariant tokens (on-scrim/on-accent) are deliberately not
        // overridden in the light block — inherit the dark value.
        const lightValue = light[cssName] ?? dark[cssName];
        expect(lightValue?.toLowerCase(), `${name} light`).toBe(token.$value.light.toLowerCase());
      }
    }
  });
});
