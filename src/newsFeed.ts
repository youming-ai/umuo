// Pure, defensive parse of ESPN's "now" news JSON into the app's NewsItem[].
// ESPN JSON is untyped/heterogeneous (categories mix team/athlete/league/guid/
// topic/…), so coerce with obj()/arr()/str() rather than trusting shapes —
// same discipline as the sport adapters. No DOM/React: unit-testable in isolation.
import type { Competition } from './competitions';
import type { NewsItem, NewsTag } from './types';
import { arr, obj, str } from './utils/coerce';
import { slugify } from './utils/helpers';

// Hide the deep ESPN league-href walk behind one helper so callers don't depend
// on four levels of nested object shape.
function getLeagueHref(c: Record<string, unknown>): string {
  const viaLeague = str(obj(obj(obj(obj(c.league).links).web).leagues).href);
  const viaCategory = str(obj(obj(obj(obj(c).links).web).leagues).href);
  return viaLeague || viaCategory;
}

// Re-order a feed so items matching the competition float to the top. Matched
// items keep their relative order, then unmatched items follow.
export function prioritizeNewsForComp(
  items: NewsItem[],
  comp: Pick<Competition, 'league' | 'label'>,
): NewsItem[] {
  const compLabel = comp.label.toLowerCase();
  const matches = (it: NewsItem) =>
    it.tags.some(
      (t) =>
        t.kind === 'league' &&
        (t.leagueSlug === comp.league || t.label.toLowerCase().includes(compLabel)),
    );
  return items.sort((a, b) => {
    const aMatches = matches(a);
    const bMatches = matches(b);
    if (aMatches && !bMatches) return -1;
    if (!aMatches && bMatches) return 1;
    return 0;
  });
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
  // site.api per-league news wraps items in `articles`; the article object shape
  // (headline/description/published/images/categories/links) is otherwise identical.
  const list = arr(root.articles).length ? arr(root.articles) : arr(root.headlines);
  return list.map((raw): NewsItem => {
    const h = obj(raw);
    const rawId = str(h.id) || str(h.nowId);
    const link = str(obj(obj(h.links).web).href);
    const headline = str(h.headline) || str(h.title);
    const published = str(h.published);
    const fallbackId = link ? slugify(link) : headline ? slugify(`${headline}-${published}`) : '';
    const id = rawId || fallbackId;
    return {
      id,
      headline,
      description: str(h.description),
      published,
      byline: str(h.byline),
      imageUrl: str(obj(arr(h.images)[0]).url),
      link,
      tags: tagsFrom(h.categories),
    };
  });
}
