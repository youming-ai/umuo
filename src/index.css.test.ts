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
  radius: Record<string, { $value: string }>;
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

  it('keeps every tokens.json radius in sync with index.css --r-*', () => {
    // Radius lives in both tokens.json and src/index.css --r-*. The color sync
    // test above exists because the palette drifted once; radius has the same
    // drift risk and no other guard, so this mirrors it. Values are dimensions
    // ("0px", "16px"); compare numerically so "0" and "0px" both read as 0.
    const toPx = (v: string) => Number.parseFloat(v.replace(/px/i, '').trim());
    for (const [name, token] of Object.entries(tokens.radius)) {
      const match = css.match(new RegExp(`--r-${name}:\\s*([^;]+);`));
      expect(match, `--r-${name} present in index.css`).not.toBeNull();
      expect(toPx(match![1])).toBe(toPx(token.$value));
    }
  });

  it('keeps the theme-color meta in sync with the dark --c-bg', () => {
    // Layout.astro is the one place --c-bg is copied as a literal: the browser
    // chrome color has to be in the markup before the stylesheet resolves.
    // Pinned the way PRUNE_CRON is pinned to wrangler.toml, since the dark
    // ground changing would otherwise silently leave the mobile chrome wrong.
    const layout = readFileSync(resolve(process.cwd(), 'src/layouts/Layout.astro'), 'utf8');
    const meta = layout.match(/name="theme-color"\s+content="rgb\(([^)]+)\)"/);
    expect(meta, 'theme-color meta in Layout.astro').not.toBeNull();

    const hex = dark.bg;
    expect(hex, '--c-bg in the dark block').toBeDefined();
    const channels = [1, 3, 5].map((i) => Number.parseInt(hex!.slice(i, i + 2), 16));
    expect(meta![1].trim()).toBe(channels.join(' '));

    // The inline theme script sets the SAME literal per branch before CSSOM
    // exists, so first paint already carries the right chrome in either theme.
    // This test pins the pair: pick them out of the script's theme record.
    const scriptTheme = layout.match(/dark:\s*'rgb\(10 14 12\)',\s*light:\s*'rgb\(([^)]+)\)'/);
    expect(scriptTheme, 'theme literals in the Layout theme script').not.toBeNull();
    const lightHex = light.bg;
    expect(lightHex, '--c-bg in the light block').toBeDefined();
    const lightChannels = [1, 3, 5].map((i) => Number.parseInt(lightHex!.slice(i, i + 2), 16));
    expect(scriptTheme![1].trim()).toBe(lightChannels.join(' '));
  });
  it('keeps the light accent readable where it actually renders', () => {
    // The 15%-fill active rail row is the dimmest surface pitch text sits on;
    // a token test on white alone would pass while the real row fails.
    const chan = (hex: string): [number, number, number] => {
      expect(hex, 'parsed hex').toMatch(/^#[0-9a-fA-F]{6}$/);
      return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
    };
    const hex = (name: string): [number, number, number] => {
      const v = light[name] ?? dark[name];
      expect(v, `--c-${name} parsed`).toBeDefined();
      return chan(v!);
    };
    const mix = (
      fg: [number, number, number],
      bg: [number, number, number],
      alpha: number,
    ): [number, number, number] =>
      fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as [number, number, number];
    const rel = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const ratio = (a: [number, number, number], b: [number, number, number]): number => {
      const lum = (c: [number, number, number]): number =>
        0.2126 * rel(c[0]) + 0.7152 * rel(c[1]) + 0.0722 * rel(c[2]);
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const toHex = (c: [number, number, number]): string =>
      `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const page = hex('bg');
    const card = chan(toHex(mix(chan('#ffffff'), page, 0.7)));
    const pitch = hex('pitch');
    const rowFill = chan(toHex(mix(pitch, page, 0.15)));
    // 11px caption text needs 4.5:1; no large-text exemption applies.
    expect(ratio(pitch, rowFill), 'pitch on active rail row').toBeGreaterThanOrEqual(4.5);
    expect(ratio(pitch, page), 'pitch on page').toBeGreaterThanOrEqual(4.5);
    expect(ratio(pitch, card), 'pitch on card').toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex('live'), page), 'live on page').toBeGreaterThanOrEqual(4.5);
  });
});
