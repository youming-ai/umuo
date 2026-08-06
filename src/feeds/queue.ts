import { getAgentByName } from 'agents';
import type { Env } from '../data/api';
import { FootballNewsAgent } from '../agents/football-news';
import type { RawArticle } from './types';

export async function processNewsQueue(batch: MessageBatch<RawArticle>, env: Env): Promise<void> {
  if (!env.FOOTBALL_NEWS_AGENT) throw new Error('FOOTBALL_NEWS_AGENT binding is required');
  const agent = await getAgentByName<Env, FootballNewsAgent>(env.FOOTBALL_NEWS_AGENT, 'global');

  for (const message of batch.messages) {
    const response = await agent.fetch(
      new Request('https://football-news-agent/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.body),
      }),
    );
    if (!response.ok) {
      batch.retryAll({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
      return;
    }
  }
}
