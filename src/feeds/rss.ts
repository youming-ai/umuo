import type { FeedSource, RawArticle } from './types';

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function stripHtml(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return '';
}

function attributeValue(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(
      new RegExp(`<[^>]*${name}[^>]*\\b(?:url|href)=['"]([^'"]+)['"]`, 'i'),
    );
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return '';
}

function imageValue(block: string): string {
  const enclosure = block.match(/<enclosure\b[^>]*\burl=['"]([^'"]+)['"][^>]*\btype=['"]image\//i);
  if (enclosure?.[1]) return decodeEntities(enclosure[1]);

  return attributeValue(block, ['media:content', 'media:thumbnail', 'image']);
}

function linkValue(block: string): string {
  const href = block.match(/<link\b[^>]*\bhref=['"]([^'"]+)['"]/i);
  if (href?.[1]) return decodeEntities(href[1]);
  return tagValue(block, ['link', 'guid']);
}

function itemBlocks(xml: string): string[] {
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (match) => match[2] ?? '',
  );
}

export function parseRss(
  xml: string,
  source: FeedSource,
  fetchedAt = Date.now(),
): Omit<RawArticle, 'canonicalUrl' | 'fingerprint'>[] {
  return itemBlocks(xml)
    .map((block): Omit<RawArticle, 'canonicalUrl' | 'fingerprint'> => {
      const title = stripHtml(tagValue(block, ['title']));
      const url = linkValue(block).trim();
      const description = stripHtml(
        tagValue(block, ['description', 'content:encoded', 'summary', 'content']),
      ).slice(0, 4000);
      const publishedRaw = tagValue(block, ['pubDate', 'published', 'updated', 'dc:date']);
      const publishedAt = Date.parse(publishedRaw) || fetchedAt;
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceAuthority: source.authorityScore,
        comp: source.comp ?? null,
        title,
        description,
        url,
        imageUrl: imageValue(block),
        publishedAt,
        fetchedAt,
      };
    })
    .filter((article) => article.title.length > 0 && article.url.length > 0);
}
