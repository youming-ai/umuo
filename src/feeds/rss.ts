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

function imageMeta(block: string): { url: string; width: number; height: number } {
  // enclosure/media:content/media:thumbnail all carry the image URL on a
  // url=/href= attribute; width/height are optional sibling attributes.
  const tag =
    block.match(/<enclosure\b[^>]*\burl=['"]([^'"]+)['"][^>]*\btype=['"]image\//i) ||
    block.match(/<(?:media:content|media:thumbnail|image)\b[^>]*\b(?:url|href)=['"]([^'"]+)['"][^>]*/i);
  const url = tag?.[1] ? decodeEntities(tag[1]) : '';
  const rawAttrs = tag?.[0] ?? '';
  const width = Number.parseInt(rawAttrs.match(/\bwidth=['"](\d+)['"]/i)?.[1] ?? '', 10);
  const height = Number.parseInt(rawAttrs.match(/\bheight=['"](\d+)['"]/i)?.[1] ?? '', 10);
  return { url, width: width > 0 ? width : 0, height: height > 0 ? height : 0 };
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
      const image = imageMeta(block);
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceAuthority: source.authorityScore,
        comp: source.comp ?? null,
        title,
        description,
        url,
        imageUrl: image.url,
        imageWidth: image.width,
        imageHeight: image.height,
        publishedAt,
        fetchedAt,
      };
    })
    .filter((article) => article.title.length > 0 && article.url.length > 0);
}
