import { z } from 'zod';
import type { ArticleEnrichment, RawArticle } from './types';

const ARTICLE_TYPES = [
  'news',
  'analysis',
  'rumor',
  'interview',
  'match-report',
  'transfer',
  'injury',
  'video',
] as const;

const enrichmentSchema = z.object({
  isFootball: z.boolean(),
  competition: z.string().max(80),
  articleType: z.enum(ARTICLE_TYPES),
  tags: z.array(z.string().min(1).max(60)).max(8),
  summary: z.string().min(1).max(280),
  blurb: z.string().min(1).max(700),
  qualityScore: z.number().int().min(0).max(100),
});

const batchSchema = z.object({ results: z.array(enrichmentSchema) });

const JSON_FIELDS = [
  'Respond as a JSON object with exactly these fields:',
  '- isFootball: boolean — true only for football/soccer stories',
  '- competition: string — "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions", or ""',
  `- articleType: string — one of: ${ARTICLE_TYPES.join(', ')}`,
  '- tags: string[] — up to 8 short lowercase-hyphen topic tags, preferring the controlled vocabulary; entity names allowed',
  '- summary: string — one factual sentence, at most 280 characters',
  '- blurb: string — concise editorial summary, at most 700 characters',
  '- qualityScore: integer 0-100 — editorial quality of THIS story, not your confidence in labelling it: substantive, well-sourced, significant reporting = high; thin rumor, clickbait, or aggregator filler = low (a confidently-labelled transfer rumor is still a low-quality rumor)',
].join('\n');

const CONTROLLED_TAGS = [
  'transfers',
  'injuries',
  'match-report',
  'match-preview',
  'tactics',
  'analysis',
  'contract',
  'financial',
  'disciplinary',
  'international',
  'youth',
  'womens',
  'awards',
  'retirement',
  'loan',
  'rumor',
  'scouting',
] as const;

const CLASSIFIER_RULES = [
  'You are the editorial classification agent for a football-only news site.',
  'Reject non-football stories with isFootball=false and an empty competition. American "football" (NFL/gridiron) is NOT football here.',
  'Use only facts present in the source text. Do not invent scores, quotes, transfers, dates, or names.',
  'Rate qualityScore on editorial merit: a confidently-labelled rumor is still low quality; a well-sourced match report or analysis is high.',
  'Choose a canonical competition only when the article clearly identifies one:',
  'eng.1 Premier League; esp.1 La Liga; ger.1 Bundesliga; ita.1 Serie A; fra.1 Ligue 1; uefa.champions Champions League.',
  'For football articles that do not clearly belong to one competition, leave competition empty.',
  `Tags: prefer the controlled vocabulary [${CONTROLLED_TAGS.join(', ')}]. You may also add proper-noun entity tags (player/club/manager names, e.g. "haaland", "real-madrid"). Do not invent topical tags outside that list — pick the closest controlled tag instead.`,
  'Examples:',
  '- "Haaland double sees City past Arsenal 3-1" with a match body → isFootball=true, comp=eng.1, articleType=match-report, tags=[match-report, haaland, man-city], qualityScore~85.',
  '- "Mbappe reportedly eyeing Real Madrid exit" sourced only to a tabloid → isFootball=true, comp=esp.1, articleType=rumor, tags=[transfers, rumor, mbappe, real-madrid], qualityScore~30.',
  '- "NFL: Mahomes leads Chiefs comeback" → isFootball=false, competition="".',
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
    `Known source competition: ${article.comp ?? 'unknown'}`,
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
 *  response_format json_object + Zod guarantee valid JSON. */
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
    // gpt-5.6-luna is a reasoning model: a chunk of 8 measured 27s end to
    // end, so the old 20s ceiling aborted every batch before it could answer.
    signal: AbortSignal.timeout(60_000 + attempt * 15_000),
  });
}

/** 3 attempts, backoff 500 × (attempt + 1), retries only on 5xx/429/throw.
 *  4xx is permanent and throws immediately. */
async function callWithRetry<T>(
  request: (attempt: number) => Promise<Response>,
  parse: (text: string) => T,
  failLabel: string,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request(attempt);
      if (response.ok) {
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = data.choices?.[0]?.message?.content ?? '';
        return parse(text);
      }
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${failLabel} failed with ${response.status}`);
      }
      if (attempt === 2) throw new Error(`${failLabel} failed with ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 500 * (attempt + 1));
    await promise;
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
    (text) => enrichmentSchema.parse(JSON.parse(text) as unknown),
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
      const { results } = batchSchema.parse(JSON.parse(text) as unknown);
      if (results.length !== articles.length) {
        throw new Error(`LLM returned ${results.length} results for ${articles.length} articles`);
      }
      return results;
    },
    'LLM batch request',
  );
}
