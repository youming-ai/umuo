import { Agent } from 'agents';
import type { Env } from '../data/api';
import { processArticle } from '../feeds/enrich';
import type { RawArticle } from '../feeds/types';

interface FootballNewsAgentState {
  processed: number;
  lastProcessedAt: number | null;
  lastError: string | null;
}

function isRawArticle(value: unknown): value is RawArticle {
  if (!value || typeof value !== 'object') return false;
  const article = value as Partial<RawArticle>;
  return (
    typeof article.sourceId === 'string' &&
    typeof article.title === 'string' &&
    typeof article.url === 'string' &&
    typeof article.canonicalUrl === 'string' &&
    typeof article.fingerprint === 'string' &&
    typeof article.publishedAt === 'number'
  );
}

export class FootballNewsAgent extends Agent<Env, FootballNewsAgentState> {
  initialState: FootballNewsAgentState = {
    processed: 0,
    lastProcessedAt: null,
    lastError: null,
  };

  async onRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/process') {
      return new Response('Not found', { status: 404 });
    }

    try {
      const body: unknown = await request.json();
      if (!isRawArticle(body)) return new Response('Invalid article', { status: 400 });
      const result = await processArticle(this.env, body);
      this.setState({
        processed: this.state.processed + (result.status === 'skipped' ? 0 : 1),
        lastProcessedAt: Date.now(),
        lastError: null,
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent error';
      this.setState({ ...this.state, lastError: message });
      console.error('[football-news-agent] article processing failed:', error);
      return Response.json({ error: message }, { status: 500 });
    }
  }
}
