import type { CompMatch, TeamStatRow, TopScorer } from '../types';
import { matchSlug, parseScore, statusFromState } from '../utils/wc';
import type {
  BoxscoreTable,
  ConferenceTable,
  MatchDetail,
  SportAdapter,
  StandingsData,
} from './types';
import { parseOdds, parseRecentForm, parseScoreboardOdds } from './summaryExtras';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function obj(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function score(v: unknown): number | null {
  return typeof v === 'string' || typeof v === 'number' ? parseScore(v) : null;
}

// ESPN standings stats are [{name, value, displayValue}]; pull the display
// string by name (PCT/GB want the pre-formatted ".714" / "-" / "3").
function statDisplay(entry: Record<string, unknown>, name: string): string {
  const s = arr(entry.stats).find((x) => obj(x).name === name);
  return s ? str(obj(s).displayValue) : '';
}
function statNum(entry: Record<string, unknown>, name: string): number {
  const s = arr(entry.stats).find((x) => obj(x).name === name);
  return s ? Number(obj(s).value) || 0 : 0;
}

function teamLogo(team: Record<string, unknown>): string {
  if (str(team.logo)) return str(team.logo);
  const logos = arr(team.logos);
  return logos.length ? str(obj(logos[0]).href) : '';
}

function transform(
  scoreboardJson: unknown,
  standingsJson: unknown,
): { matches: CompMatch[]; standings: StandingsData; scorers: TopScorer[] } {
  const sbJson = scoreboardJson;
  const stJson = standingsJson;

  // --- standings → conference tables (Eastern / Western) ---
  const conferences: ConferenceTable[] = arr(obj(stJson).children).map((raw): ConferenceTable => {
    const c = obj(raw);
    const entries = arr(obj(c.standings).entries);
    const rows = entries.map((rawEntry) => {
      const e = obj(rawEntry);
      const team = obj(e.team);
      return {
        teamId: str(team.id),
        name: str(team.displayName),
        logo: teamLogo(team),
        w: statNum(e, 'wins'),
        l: statNum(e, 'losses'),
        pct: statDisplay(e, 'leagueWinPercent'),
        gb: statDisplay(e, 'gamesBehind'),
      };
    });
    return { name: str(c.name), rows };
  });

  // --- scoreboard → matches (no stage/group; statusText from shortDetail) ---
  const matches: CompMatch[] = arr(obj(sbJson).events).map((rawEvent): CompMatch => {
    const ev = obj(rawEvent);
    const comp = obj(arr(ev.competitions)[0]);
    const competitors = arr(comp.competitors).map(obj);
    const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
    const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
    const homeTeam = obj(home.team);
    const awayTeam = obj(away.team);
    const statusObj = obj(comp.status);
    const status = statusFromState(str(obj(statusObj.type).state));

    const venue = obj(comp.venue);
    const city = str(obj(venue.address).city);
    const venueName = str(venue.fullName);
    const date = str(ev.date);
    const kickoff = date ? new Date(date) : null;

    const winner =
      status === 'finished'
        ? home.winner === true
          ? 'home'
          : away.winner === true
            ? 'away'
            : undefined
        : undefined;

    const statusText = str(obj(statusObj.type).shortDetail);

    return {
      id: str(ev.id),
      homeName: str(homeTeam.displayName),
      awayName: str(awayTeam.displayName),
      homeFlag: teamLogo(homeTeam),
      awayFlag: teamLogo(awayTeam),
      homeId: str(homeTeam.id),
      awayId: str(awayTeam.id),
      homeScore: status === 'upcoming' ? null : score(home.score),
      awayScore: status === 'upcoming' ? null : score(away.score),
      kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null,
      status,
      homeScorers: [],
      awayScorers: [],
      venue: venueName && city ? `${venueName} · ${city}` : venueName,
      slug: matchSlug(str(homeTeam.displayName), str(awayTeam.displayName), str(ev.id)),
      odds: parseScoreboardOdds(comp.odds),
      ...(statusText ? { statusText } : {}),
      ...(winner ? { winner } : {}),
    };
  });

  return { matches, standings: { kind: 'basketball', conferences }, scorers: [] };
}

function transformSummary(json: unknown): MatchDetail {
  const d = obj(json);

  const competitors = arr(obj(arr(obj(d.header).competitions)[0]).competitors).map(obj);
  const homeId = str(obj(competitors.find((c) => c.homeAway === 'home')?.team).id);
  const awayId = str(obj(competitors.find((c) => c.homeAway === 'away')?.team).id);

  // team stats: map each boxscore team's label→displayValue, pair by home order
  const byTeam = new Map<string, Map<string, string>>();
  for (const rawTeam of arr(obj(d.boxscore).teams)) {
    const t = obj(rawTeam);
    const id = str(obj(t.team).id);
    const m = new Map<string, string>();
    for (const rawStat of arr(t.statistics)) {
      const s = obj(rawStat);
      m.set(str(s.label), str(s.displayValue));
    }
    byTeam.set(id, m);
  }
  const homeStats = byTeam.get(homeId) ?? new Map();
  const awayStats = byTeam.get(awayId) ?? new Map();
  const statLabels = [
    ...homeStats.keys(),
    ...[...awayStats.keys()].filter((label) => !homeStats.has(label)),
  ];
  const teamStats: TeamStatRow[] = statLabels.map((label) => ({
    label,
    home: homeStats.get(label) ?? '',
    away: awayStats.get(label) ?? '',
  }));

  // player boxscore tables: one per team. ESPN nests labels + athletes under
  // boxscore.players[].statistics[0].
  const playerTables: BoxscoreTable[] = arr(obj(d.boxscore).players).map((raw): BoxscoreTable => {
    const p = obj(raw);
    const team = obj(p.team);
    const block = obj(arr(p.statistics)[0]);
    const labels = arr(block.labels).map((x) => str(x));
    const players = arr(block.athletes).map((rawA) => {
      const a = obj(rawA);
      return {
        name: str(obj(a.athlete).displayName),
        starter: Boolean(a.starter),
        dnp: Boolean(a.didNotPlay),
        stats: arr(a.stats).map((x) => str(x)),
      };
    });
    return { teamId: str(team.id), teamName: str(team.displayName), labels, players };
  });
  // Enforce [home, away] regardless of ESPN order.
  const rank = (b: BoxscoreTable) => (b.teamId === homeId ? 0 : b.teamId === awayId ? 1 : 2);
  playerTables.sort((a, b) => rank(a) - rank(b));

  const venueObj = obj(obj(d.gameInfo).venue);
  const city = str(obj(venueObj.address).city);
  const venueName = str(venueObj.fullName);
  const att = obj(d.gameInfo).attendance;

  return {
    kind: 'basketball',
    homeId,
    awayId,
    teamStats,
    playerTables,
    venue: venueName && city ? `${venueName} · ${city}` : venueName,
    attendance: typeof att === 'number' ? att : null,
    odds: parseOdds(d),
    form: parseRecentForm(d),
  };
}

export const basketballAdapter: SportAdapter = { transform, transformSummary };
