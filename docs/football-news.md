# Football news operations

This document describes the implemented football-only content path. The older `ai-news-aggregation-rfc.md` is retained as the original design record.

## Ingestion lifecycle

1. `worker/entrypoint.ts` receives the Cron event.
2. `src/feeds/ingest.ts` upserts the source registry into D1, fetches enabled sources, parses RSS/ESPN JSON, canonicalizes URLs, and creates SHA-256 fingerprints.
3. Normalized `RawArticle` messages are sent to `INGEST_QUEUE` in batches of at most 100.
4. The Queue consumer routes each message to the named `FootballNewsAgent` Durable Object.
5. The Agent calls Gemini with a structured JSON schema, rejects non-football content, and writes the enrichment and tags to D1 in a batch.
6. `src/data/api.ts` reads only published football articles for `/api/explore` and SSR pages, with a short KV cache around parameterized results.

The Agent is deliberately the only code path that writes articles. This makes AI classification and storage auditable and keeps the page request path read-only.

## D1 schema

- `sources`: source registry mirrored from `src/feeds/sources.ts`.
- `source_health`: last fetch/success, failure streak, latency and counters.
- `articles`: raw source fields plus AI summary, blurb, type, competition, scores and status.
- `article_tags`: normalized tags for filtering.
- `article_clusters`: reserved for cross-source semantic clustering.

Apply `migrations/0001_football_news.sql` with Wrangler before deploying the Worker. The first scheduled run also creates/updates the dynamic ESPN football source rows.

## Secrets and configuration

- `GEMINI_API_KEY` is a Wrangler secret in production and a `.dev.vars` value locally.
- `GEMINI_MODEL` is a non-secret Wrangler variable; the default is `gemini-3.6-flash`.
- `DB`, `INGEST_QUEUE`, `FOOTBALL_NEWS_AGENT`, `CACHE`, and `ASSETS` are generated into `worker-configuration.d.ts` by `bunx wrangler types`.

## Failure handling

- Source fetches retry transient 429/5xx responses and record failures in `source_health`.
- Queue messages retry with exponential delay; after the configured retry limit they go to `umuo-news-ingest-dlq`.
- Agent writes are idempotent on canonical URL/fingerprint, so a retried message does not duplicate an article.
- Invalid Gemini output is rejected by Zod and retried; it is never silently published.
- SSR reads degrade to an empty Explore feed if D1 is unavailable. The legacy ESPN data layer continues to serve KV stale data for compatibility pages.
