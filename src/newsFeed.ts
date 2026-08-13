// Defensive parse of ESPN's league-news JSON into NewsItem[]. ESPN JSON is
// untyped/heterogeneous (categories mix team/athlete/league/guid/topic/…),
// so coerce with obj()/arr()/str() rather than trusting shapes.
import type { NewsItem, NewsTag } from './types';
import { arr, obj, str } from './utils/coerce';
import { slugify } from './utils/helpers';

function getLeagueHref(c: Record<string, unknown>): string {
  const viaLeague = str(obj(obj(obj(obj(c.league).links).web).leagues).href);
  const viaCategory = str(obj(obj(obj(obj(c).links).web).leagues).href);
  return viaLeague || viaCategory;
}

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
      const href = getLeagueHref(c);
      const match = href.match(/\/league\/_\/name\/([a-z0-9.]+)/i);
      const leagueSlug = match ? match[1].toLowerCase() : undefined;
      const key = `league:${label}:${leagueSlug ?? ''}`;
      if (label && !seen.has(key)) {
        seen.add(key);
        tags.push(leagueSlug ? { kind: 'league', label, leagueSlug } : { kind: 'league', label });
      }
    }
    // ignore guid/topic/event/contributor/sportseason
  }
  return tags;
}

export function parseNewsFeed(json: unknown): NewsItem[] {
  const root = obj(json);
  // site.api per-league news wraps items in `articles`; the shape is otherwise identical.
  const list = arr(root.articles).length ? arr(root.articles) : arr(root.headlines);
  return list.map((raw): NewsItem => {
    const h = obj(raw);
    const rawId = str(h.id) || str(h.nowId);
    const link = str(obj(obj(h.links).web).href);
    const headline = str(h.headline) || str(h.title);
    const published = str(h.published);
    const fallbackId = link ? slugify(link) : headline ? slugify(`${headline}-${published}`) : '';
    const id = rawId || fallbackId;
    const img = obj(arr(h.images)[0]);
    const imageWidth = Number.parseInt(str(img.width), 10);
    const imageHeight = Number.parseInt(str(img.height), 10);
    return {
      id,
      headline,
      description: str(h.description),
      published,
      byline: str(h.byline),
      imageUrl: str(img.url),
      imageWidth: imageWidth > 0 ? imageWidth : 0,
      imageHeight: imageHeight > 0 ? imageHeight : 0,
      link,
      tags: tagsFrom(h.categories),
    };
  });
}
