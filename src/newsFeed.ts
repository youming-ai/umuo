// Pure, defensive parse of ESPN's "now" news JSON into the app's NewsItem[].
// ESPN JSON is untyped/heterogeneous (categories mix team/athlete/league/guid/
// topic/…), so coerce with obj()/arr()/str() rather than trusting shapes —
// same discipline as the sport adapters. No DOM/React: unit-testable in isolation.
import type { NewsItem, NewsTag } from './types';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown): Record<string, unknown> {
  return isObj(v) ? v : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

// Pull team/athlete/league entities out of a headline's `categories`, deduped.
function tagsFrom(categories: unknown): NewsTag[] {
  const tags: NewsTag[] = [];
  const seen = new Set<string>();
  for (const raw of arr(categories)) {
    const c = obj(raw);
    const type = str(c.type);
    if (type === 'team') {
      const label = str(c.description) || str(obj(c.team).shortDisplayName);
      const team = str(obj(c.team).abbreviation).toLowerCase();
      const key = `team:${team}:${label}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push(team ? { kind: 'team', label, team } : { kind: 'team', label });
      }
    } else if (type === 'athlete') {
      const label = str(c.description) || str(obj(c.athlete).description);
      const key = `athlete:${label}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push({ kind: 'athlete', label });
      }
    } else if (type === 'league') {
      const label = str(c.description) || str(obj(c.league).description);
      const key = `league:${label}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push({ kind: 'league', label });
      }
    }
    // ignore guid/topic/event/contributor/sportseason
  }
  return tags;
}

export function parseNewsFeed(json: unknown): NewsItem[] {
  return arr(obj(json).headlines).map((raw): NewsItem => {
    const h = obj(raw);
    return {
      id: str(h.id) || str(h.nowId),
      headline: str(h.headline) || str(h.title),
      description: str(h.description),
      published: str(h.published),
      byline: str(h.byline),
      imageUrl: str(obj(arr(h.images)[0]).url),
      link: str(obj(obj(h.links).web).href),
      tags: tagsFrom(h.categories),
    };
  });
}
