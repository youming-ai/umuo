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

const RESPONSE_SCHEMA = {
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
    'You are the editorial classification agent for a football-only news site.',
    'Classify and summarize the supplied source article as JSON matching the schema.',
    'Reject non-football stories with isFootball=false and an empty competition.',
    'Use only facts present in the source text. Do not invent scores, quotes, transfers, dates, or names.',
    'Choose a canonical competition only when the article clearly identifies one:',
    'eng.1 Premier League; esp.1 La Liga; ger.1 Bundesliga; ita.1 Serie A; fra.1 Ligue 1; uefa.champions Champions League.',
    'For football articles that do not clearly belong to one competition, leave competition empty.',
    '',
    `Source: ${article.sourceName}`,
    `Known source competition: ${article.comp ?? 'unknown'}`,
    `Title: ${article.title}`,
    `Description: ${article.description || '(none)'}`,
    `URL: ${article.url}`,
  ].join('\n');
}

async function requestGemini(
  apiKey: string,
  model: string,
  input: string,
  attempt: number,
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
        schema: RESPONSE_SCHEMA,
      },
      store: false,
    }),
    signal: AbortSignal.timeout(20_000 + attempt * 5_000),
  });
  return response;
}

export async function enrichWithGemini(
  apiKey: string,
  model: string,
  article: RawArticle,
): Promise<ArticleEnrichment> {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await requestGemini(apiKey, model, promptFor(article), attempt);
      if (response.ok) {
        const text = outputText(await response.json());
        const parsed = JSON.parse(text) as unknown;
        return enrichmentSchema.parse(parsed);
      }

      if (response.status < 500 && response.status !== 429) {
        throw new Error(`Gemini request failed with ${response.status}`);
      }
      if (attempt === 2) throw new Error(`Gemini request failed with ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  throw new Error('Gemini enrichment failed');
}
