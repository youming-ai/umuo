import { sleep } from '../utils/coerce';
import type { ArticleEnrichment, RawArticle } from './types';

const ARTICLE_TYPES = ['news', 'review', 'deal', 'leak', 'analysis', 'guide', 'video'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEnrichment(v: unknown): ArticleEnrichment {
  if (!isObject(v)) throw new Error('invalid enrichment');
  const { isOnTopic, category, articleType, tags, summary, blurb, qualityScore } = v;
  if (typeof isOnTopic !== 'boolean') throw new Error('invalid isOnTopic');
  if (typeof category !== 'string' || category.length > 40) throw new Error('invalid category');
  if (
    typeof articleType !== 'string' ||
    !(ARTICLE_TYPES as readonly string[]).includes(articleType)
  )
    throw new Error('invalid articleType');
  if (
    !Array.isArray(tags) ||
    tags.length > 8 ||
    tags.some((t) => typeof t !== 'string' || t.length < 1 || t.length > 60)
  )
    throw new Error('invalid tags');
  if (typeof summary !== 'string' || summary.length < 1 || summary.length > 280)
    throw new Error('invalid summary');
  if (typeof blurb !== 'string' || blurb.length < 1 || blurb.length > 700)
    throw new Error('invalid blurb');
  if (
    typeof qualityScore !== 'number' ||
    !Number.isInteger(qualityScore) ||
    qualityScore < 0 ||
    qualityScore > 100
  )
    throw new Error('invalid qualityScore');
  return v as unknown as ArticleEnrichment;
}

function parseBatch(v: unknown): ArticleEnrichment[] {
  if (!isObject(v) || !Array.isArray((v as Record<string, unknown>).results))
    throw new Error('invalid batch');
  const results = (v as { results: unknown[] }).results;
  return results.map(parseEnrichment);
}

const JSON_FIELDS = [
  'Respond as a JSON object with exactly these fields:',
  '- isOnTopic: boolean — true only for PC hardware and peripherals stories',
  '- category: string — "keyboards", "mice", "audio", "gear", "gpu", "cpu", "memory", "storage", "monitor", "cooling", or ""',
  `- articleType: string — one of: ${ARTICLE_TYPES.join(', ')}`,
  '- tags: string[] — up to 8 short lowercase-hyphen topic tags, preferring the controlled vocabulary; brand/product names allowed',
  '- summary: string — one factual sentence, at most 280 characters',
  '- blurb: string — concise editorial summary, at most 700 characters',
  '- qualityScore: integer 0-100 — editorial quality of THIS story, not your confidence in labelling it: substantive, well-sourced, significant reporting = high; thin rumor, clickbait, or aggregator filler = low (a confidently-labelled leak is still a low-quality leak)',
].join('\n');

const CONTROLLED_TAGS = [
  'keyboards',
  'keycaps',
  'switches',
  'mice',
  'mousepads',
  'headsets',
  'earbuds',
  'controllers',
  'gpu',
  'cpu',
  'motherboard',
  'ram',
  'ssd',
  'nas',
  'monitor',
  'oled',
  'psu',
  'cooling',
  'overclocking',
  'benchmarks',
  'deals',
  'leak',
  'diy',
  'wireless',
] as const;

const CLASSIFIER_RULES = [
  'You are the editorial classification agent for a PC hardware and peripherals news site.',
  'isOnTopic=true only for computer hardware and peripherals: keyboards, keycaps and switches; mice and mousepads; audio gear (headsets, earbuds, speakers, microphones); other desk gear (controllers, webcams, desks, chairs); GPUs, CPUs, motherboards, RAM, storage drives; monitors; cases, power supplies and cooling. Phones, tablets, smartwatches, game consoles, games, and pure-software or AI-policy stories are NOT on-topic.',
  'Reject off-topic stories with isOnTopic=false and an empty category.',
  'Use only facts present in the source text. Do not invent specs, prices, release dates, or product names.',
  'Rate qualityScore on editorial merit: a confidently-labelled leak is still low quality; a hands-on review with measured results or a well-sourced component announcement is high.',
  'Choose a canonical category only when the article is clearly about one:',
  'keyboards Keyboards; mice Mice; audio Headphones & Audio; gear Other Peripherals; gpu Graphics Cards; cpu CPUs & Motherboards; memory RAM; storage SSDs & Drives; monitor Monitors; cooling Cases, PSUs & Cooling.',
  'For cross-category hardware stories (laptops, full PC builds, industry/business news, roundups spanning many parts), leave category empty.',
  `Tags: prefer the controlled vocabulary [${CONTROLLED_TAGS.join(', ')}]. You may also add proper-noun entity tags (brand/product names, e.g. "nvidia", "wooting", "rtx-5090"). Do not invent topical tags outside that list — pick the closest controlled tag instead.`,
  'Examples:',
  '- "Keychron Q1 Max review: refined, thocky, and finally wireless" with measured results → isOnTopic=true, category=keyboards, articleType=review, tags=[keyboards, wireless, keychron], qualityScore~85.',
  '- "RTX 5080 Super pictured with 24GB" sourced only to a leaker → isOnTopic=true, category=gpu, articleType=leak, tags=[gpu, leak, nvidia], qualityScore~35.',
  '- "RX 7800 XT drops to $459 at Newegg" → isOnTopic=true, category=gpu, articleType=deal, tags=[deals, gpu, amd], qualityScore~70.',
  '- "iPhone 18 rumor roundup: what to expect" → isOnTopic=false, category="".',
];

function articleText(article: RawArticle): string {
  // Prefer the fetched/syndicated body over the feed teaser so the blurb and
  // tags reflect the actual story, not a one-line hook.
  const body = article.body ?? '';
  return body.length > article.description.length ? body : article.description || '(none)';
}

function articleBlock(article: RawArticle): string[] {
  return [
    `Source: ${article.sourceName}`,
    `Known source category: ${article.category ?? 'unknown'}`,
    `Title: ${article.title}`,
    `Text: ${articleText(article)}`,
    `URL: ${article.url}`,
  ];
}

function promptFor(article: RawArticle): string {
  return [...CLASSIFIER_RULES, JSON_FIELDS, '', ...articleBlock(article)].join('\n');
}

function promptForBatch(articles: RawArticle[]): string {
  return [
    ...CLASSIFIER_RULES,
    `Classify and summarize each of the ${articles.length} articles below.`,
    `Return a JSON object {"results": [...]} holding exactly one object per article, in the same order.`,
    `Each object must have these fields:\n${JSON_FIELDS}`,
    'Judge each article only on its own text; do not let one influence another.',
    '',
    ...articles.flatMap((article, index) => [
      `--- ARTICLE ${index + 1} ---`,
      ...articleBlock(article),
      '',
    ]),
  ].join('\n');
}

/** One OpenAI-compatible /chat/completions call. baseUrl is configurable
 *  (env LLM_BASE_URL) so the same code works against any compatible endpoint.
 *  response_format json_object + manual validation guarantee valid JSON. */
async function requestLLM(
  apiKey: string,
  baseUrl: string,
  model: string,
  input: string,
  attempt: number,
): Promise<Response> {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: input }],
      response_format: { type: 'json_object' },
    }),
    // deepseek-v4-flash is a reasoning model: a chunk of 8 measured 27s end to
    // end, so the old 20s ceiling aborted every batch before it could answer.
    signal: AbortSignal.timeout(60_000 + attempt * 15_000),
  });
}

/** 3 attempts, backoff 500 × (attempt + 1). Every failure — HTTP error status
 *  or invalid payload — retries; the last attempt's error propagates. */
async function callWithRetry<T>(
  request: (attempt: number) => Promise<Response>,
  parse: (text: string) => T,
  failLabel: string,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request(attempt);
      if (response.ok) {
        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        return parse(data.choices?.[0]?.message?.content ?? '');
      }
      throw new Error(`${failLabel} failed with ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await sleep(500 * (attempt + 1));
  }
  throw new Error(`${failLabel} failed`);
}

export async function enrichWithLLM(
  apiKey: string,
  baseUrl: string,
  model: string,
  article: RawArticle,
): Promise<ArticleEnrichment> {
  if (!apiKey) throw new Error('LLM_API_KEY is not configured');
  return callWithRetry(
    (attempt) => requestLLM(apiKey, baseUrl, model, promptFor(article), attempt),
    (text) => parseEnrichment(JSON.parse(text) as unknown),
    'LLM request',
  );
}

/** One call for a whole batch. A response whose length does not match the
 *  input is rejected outright — the caller falls back to per-article calls. */
export async function enrichBatchWithLLM(
  apiKey: string,
  baseUrl: string,
  model: string,
  articles: RawArticle[],
): Promise<ArticleEnrichment[]> {
  if (!apiKey) throw new Error('LLM_API_KEY is not configured');
  if (articles.length === 0) return [];
  return callWithRetry(
    (attempt) => requestLLM(apiKey, baseUrl, model, promptForBatch(articles), attempt),
    (text) => {
      const results = parseBatch(JSON.parse(text) as unknown);
      if (results.length !== articles.length) {
        throw new Error(`LLM returned ${results.length} results for ${articles.length} articles`);
      }
      return results;
    },
    'LLM batch request',
  );
}
