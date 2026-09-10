// Defensive coercion helpers shared by the feed and data layers.

export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
}

/** Shared HTML entity decoder for rss. */
export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#(\d+);/g, (_m, c: string) => String.fromCodePoint(Number(c)))
    .replace(/&#x([\da-f]+);/gi, (_m, c: string) => String.fromCodePoint(Number.parseInt(c, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&[lr]dquo;/g, '"')
    .replace(/&[lr]squo;/g, "'")
    .replace(/&hellip;/g, '\u2026')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Escape XML special characters for RSS/sitemaps. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
