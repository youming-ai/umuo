import { describe, expect, it } from 'vitest';
import { decodeEntities, escapeXml, num } from './coerce';

describe('num', () => {
  it('passes finite numbers through and coerces numeric strings', () => {
    expect(num(3)).toBe(3);
    expect(num('3')).toBe(3);
    expect(num(Number.NaN)).toBe(0);
  });
});

describe('decodeEntities', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&amp; &lt; &mdash; &#8217;')).toBe('& < — ’');
  });
});

describe('escapeXml', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&apos;');
  });
});
