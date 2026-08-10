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

const ENRICHMENT_PROPERTIES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    isFootball: { type: 'boolean' },
    competition: { type: 'string', description: 'Canonical competition key, or an empty string.' },
    articleType: { type: 'string', enum: ARTICLE_TYPES },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    summary: { type: 'string', description: 'One factual sentence, at most 280 characters.' },
    blurb: { type: 'string', description: 'A concise editorial summary, at most 700 characters.' },
    qualityScore: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: [
    'isFootball',
    'competition',
    'articleType',
    'tags',
    'summary',
    'blurb',
    'qualityScore',
  ],
} as const;

const RESPONSE_SCHEMA = ENRICHMENT_PROPERTIES;

// A whole queue batch in one interaction. Results are positional, so the schema
// pins the array and the prompt repeats the ordering requirement; a response of
// the wrong length is rejected rather than mapped onto the wrong articles.
const BATCH_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { results: { type: 'array', items: ENRICHMENT_PROPERTIES } },
  required: ['results'],
} as const;

const batchSchema = z.object({ results: z.array(enrichmentSchema) });

interface GeminiResponse {
  output_text?: unknown;
  outputs?: unknown;
  output?: unknown;
  steps?: unknown;
}

function textFromNode(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textFromNode(item);
      if (text) return text;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';

  const node = value as Record<string, unknown>;
  for (const key of ['text', 'value', 'content']) {
    const text = textFromNode(node[key]);
    if (text) return text;
  }
  return '';
}

function outputText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const response = value as GeminiResponse;
  for (const candidate of [
    response.output_text,
    response.outputs,
    response.output,
    response.steps,
  ]) {
    const text = textFromNode(candidate);
    if (text) return text;
  }
  return '';
}

function promptFor(article: RawArticle): string {
  return [
    ...CLASSIFIER_RULES,
    'Classify and summarize the supplied source article as JSON matching the schema.',
    '',
    ...articleBlock(article),
  ].join('\n');
}

const CLASSIFIER_RULES = [
  'You are the editorial classification agent for a football-only news site.',
  'Reject non-football stories with isFootball=false and an empty competition.',
  'Use only facts present in the source text. Do not invent scores, quotes, transfers, dates, or names.',
  'Choose a canonical competition only when the article clearly identifies one:',
  'eng.1 Premier League; esp.1 La Liga; ger.1 Bundesliga; ita.1 Serie A; fra.1 Ligue 1; uefa.champions Champions League.',
  'For football articles that do not clearly belong to one competition, leave competition empty.',
];

function articleBlock(article: RawArticle): string[] {
  return [
    `Source: ${article.sourceName}`,
    `Known source competition: ${article.comp ?? 'unknown'}`,
    `Title: ${article.title}`,
    `Description: ${article.description || '(none)'}`,
    `URL: ${article.url}`,
  ];
}

function promptForBatch(articles: RawArticle[]): string {
  return [
    ...CLASSIFIER_RULES,
    `Classify and summarize each of the ${articles.length} articles below.`,
    'Return "results" holding exactly one object per article, in the same order.',
    'Judge each article only on its own text; do not let one influence another.',
    '',
    ...articles.flatMap((article, index) => [
      `--- ARTICLE ${index + 1} ---`,
      ...articleBlock(article),
      '',
    ]),
  ].join('\n');
}

async function requestGemini(
  apiKey: string,
  model: string,
  input: string,
  attempt: number,
  schema: unknown = RESPONSE_SCHEMA,
): Promise<Response> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      input,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema,
      },
      store: false,
    }),
    signal: AbortSignal.timeout(20_000 + attempt * 5_000),
  });
  return response;
}

/**
 * Shared retry/backoff scaffold for the two enrichment paths. 3 attempts,
 * backoff `500 * (attempt + 1)`, retries only on 5xx/429/throw. A 4xx is a
 * permanent failure (bad request) and throws immediately. Returns whatever
 * `parse` extracts from a successful response.
 */
async function callWithRetry<T>(
  request: (attempt: number) => Promise<Response>,
  parse: (text: string) => T,
  failLabel: string,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request(attempt);
      if (response.ok) {
        const text = outputText(await response.json());
        return parse(text);
      }
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${failLabel} failed with ${response.status}`);
      }
      if (attempt === 2) throw new Error(`${failLabel} failed with ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(`${failLabel} failed`);
}

export async function enrichWithGemini(
  apiKey: string,
  model: string,
  article: RawArticle,
): Promise<ArticleEnrichment> {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  return callWithRetry(
    (attempt) => requestGemini(apiKey, model, promptFor(article), attempt),
    (text) => enrichmentSchema.parse(JSON.parse(text) as unknown),
    'Gemini request',
  );
}

/**
 * One interaction for a whole queue batch. Results are positional, so a
 * response whose length does not match the input is rejected outright rather
 * than risking an article being written with another article's summary — the
 * caller falls back to per-article calls when that happens.
 *
 * Only worth it in bursts. Steady state is a handful of new articles per tick,
 * where this is one call instead of three; it earns its keep on a backfill, a
 * newly added source, or a feed catching up after an outage.
 */
export async function enrichBatchWithGemini(
  apiKey: string,
  model: string,
  articles: RawArticle[],
): Promise<ArticleEnrichment[]> {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  if (articles.length === 0) return [];
  return callWithRetry(
    (attempt) =>
      requestGemini(apiKey, model, promptForBatch(articles), attempt, BATCH_RESPONSE_SCHEMA),
    (text) => {
      const { results } = batchSchema.parse(JSON.parse(text) as unknown);
      if (results.length !== articles.length) {
        throw new Error(
          `Gemini returned ${results.length} results for ${articles.length} articles`,
        );
      }
      return results;
    },
    'Gemini batch request',
  );
}
