/** Crude HTML → plain text for feeding the enrichment model.
 *
 * No DOM in Workers, so this strips tags with regexes instead of a Readability
 * pass. It drops script/style/nav/footer/header/aside blocks first, then all
 * remaining tags, decodes a few entities, and collapses whitespace. The model
 * is robust to residual boilerplate, and the caller truncates.
 *
 * ponytail: regex stripping leaves ad/boilerplate noise and misses
 * JS-rendered bodies. Ceiling is summaries with stray nav text. Upgrade path:
 * linkedom + @mozilla/readability if summaries visibly degrade. */
export function extractText(html: string): string {
  return html
    .replace(
      /<(script|style|nav|footer|header|aside|noscript|head|title|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
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
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
