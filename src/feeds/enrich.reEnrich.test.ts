// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../data/api';
import { reEnrichBatch } from './enrich';

// reEnrichBatch reconstructs RawArticle from a stored row, refetches the body,
// calls the model, and UPDATEs the row + replaces tags. This test wires a fake
// D1 + a fake fetch (article page + LLM endpoint) end to end so the whole
// orchestration — eligibility SELECT, highest-quality-first order, UPDATE with
// the new score, tag replacement, remaining count — is exercised once.

const RAW_ROW = {
  id: 'fp-1',
  fingerprint: 'fp-1',
  title: 'Haaland double sees City past Arsenal',
  description: 'short teaser',
  canonical_url: 'https://example.com/story',
  image_url: '',
  image_width: 0,
  image_height: 0,
  published_at: 1780000000000,
  fetched_at: 1780000000000,
  comp: 'eng.1',
  source_id: 'bbc',
  source_name: 'BBC Sport',
  authority_score: 92,
};

const ENRICHMENT = {
  isFootball: true,
  competition: 'eng.1',
  articleType: 'match-report' as const,
  tags: ['match-report', 'haaland', 'man-city'],
  summary: 'Haaland scored twice.',
  blurb: 'A concise match report.',
  qualityScore: 85,
};

function llmResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function makeEnv(): { env: Env; stmts: string[] } {
  const stmts: string[] = [];

  function prepared(sql: string) {
    stmts.push(sql);
    const bound = {
      all: vi.fn(async () => ({ results: [RAW_ROW] })),
    };
    // COUNT(*) AS n → remaining
    if (/COUNT/i.test(sql)) bound.all = vi.fn(async () => ({ results: [{ n: 0 }] })) as never;
    return {
      bind: vi.fn(() => {
        const b = {
          all: bound.all,
          first: vi.fn(async () => ({ n: 0 })),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        };
        return b;
      }),
      all: bound.all,
      first: vi.fn(async () => ({ n: 0 })),
    };
  }

  const db = {
    prepare: vi.fn((sql: string) => prepared(sql)),
    batch: vi.fn(async (stmtsArr: { bind?: () => unknown }[]) => {
      for (const s of stmtsArr) s.bind?.();
      return stmtsArr.map(() => ({ results: [] }));
    }),
  };
  const env = {
    DB: db,
    LLM_API_KEY: 'secret',
    LLM_BASE_URL: 'https://api.b.ai/v1',
    LLM_MODEL: 'deepseek-v4-flash',
  } as unknown as Env;
  return { env, stmts };
}

describe('reEnrichBatch', () => {
  it('selects eligible rows, re-scores, updates the row and replaces tags', async () => {
    const { env, stmts } = makeEnv();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('chat/completions')) return Promise.resolve(llmResponse(ENRICHMENT));
      return Promise.resolve(
        new Response(
          '<html><body><article><p>' +
            'Haaland scored twice. '.repeat(30) +
            '</p></article></body></html>',
          {
            headers: { 'content-type': 'text/html' },
          },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const report = await reEnrichBatch(env, 8);

    expect(report.processed).toBe(1);
    // Eligibility query targets never-re-enriched published rows, best first.
    expect(stmts.some((s) => /updated_at = a\.created_at/.test(s))).toBe(true);
    expect(stmts.some((s) => /ORDER BY a\.quality_score DESC/.test(s))).toBe(true);
    // The row was updated with the new editorial score.
    expect(stmts.some((s) => /UPDATE articles SET/.test(s))).toBe(true);
    // Old tags cleared before the new ones are written.
    expect(stmts.some((s) => /DELETE FROM article_tags/.test(s))).toBe(true);
    // Body fetched from the canonical URL before the model call.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('example.com/story'))).toBe(true);
    // The LLM was called.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('chat/completions'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns an empty report when nothing is eligible', async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) },
      LLM_API_KEY: 'secret',
    } as unknown as Env;
    const report = await reEnrichBatch(env, 8);
    expect(report).toEqual({ processed: 0, failed: 0, remaining: 0 });
  });
});
