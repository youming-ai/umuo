import type {
  CompMatch,
  LineupPlayer,
  PlayEvent,
  ScorerEntry,
  TeamLineup,
  TopScorer,
  Group,
  WCStanding,
} from '../types';
import {
  matchSlug,
  parseScore,
  progressFromStatus,
  sortStandings,
  statusFromState,
} from '../utils/wc';
import { parseScoreboardOdds, parseSummaryBase } from './summaryExtras';
import type { MatchDetail, SportAdapter, StandingsData } from './types';
import { arr, obj, str, teamLogo } from '../utils/coerce';

// ESPN standings stats are [{name, value}]; pull one by name.
function stat(entry: Record<string, unknown>, name: string): number {
  const s = arr(entry.stats).find((x) => obj(x).name === name);
  return s ? Number(obj(s).value) || 0 : 0;
}

function cardOf(plays: unknown[]): 'yellow' | 'red' | undefined {
  let card: 'yellow' | undefined;
  for (const raw of plays) {
    const p = obj(raw);
    if (p.redCard) return 'red';
    if (p.yellowCard) card = 'yellow';
  }
  return card;
}
function subClock(plays: unknown[]): string | undefined {
  const s = plays.map(obj).find((p) => p.substitution);
  return s ? str(obj(s.clock).displayValue) : undefined;
}

function transform(
  scoreboardJson: unknown,
  standingsJson: unknown,
): { matches: CompMatch[]; standings: StandingsData; scorers: TopScorer[] } {
  const sbJson = scoreboardJson;
  const stJson = standingsJson;

  // --- standings → groups ---
  const gr: Group[] = arr(obj(stJson).children)
    .map((raw): Group => {
      const g = obj(raw);
      const letter = str(g.name).replace(/^Group\s+/i, '') || str(g.abbreviation);
      const entries = arr(obj(g.standings).entries);
      const standings = entries.map((rawEntry): WCStanding => {
        const e = obj(rawEntry);
        const team = obj(e.team);
        const id = str(team.id);
        return {
          teamId: id,
          name: str(team.displayName),
          flag: teamLogo(team),
          mp: stat(e, 'gamesPlayed'),
          w: stat(e, 'wins'),
          d: stat(e, 'ties'),
          l: stat(e, 'losses'),
          gf: stat(e, 'pointsFor'),
          ga: stat(e, 'pointsAgainst'),
          gd: stat(e, 'pointDifferential'),
          pts: stat(e, 'points'),
        };
      });
      return { name: letter, standings: sortStandings(standings) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- scoreboard → matches ---
  // Per-team form (last-5 W/D/L string). Aggregated across every event
  // the team appears in: a team plays 3 group matches, each event's
  // `competitor.form` covers a different sliding window. We pick the
  // first 5 chars of any form we see; the most-recent one is the one
  // attached to the team's latest event in the data.
  const teamForm = new Map<string, { value: string; eventAt: number }>();
  const ms: CompMatch[] = arr(obj(sbJson).events).map((rawEvent): CompMatch => {
    const ev = obj(rawEvent);
    const parsedEventAt = Date.parse(str(ev.date));
    const eventAt = Number.isNaN(parsedEventAt) ? Number.NEGATIVE_INFINITY : parsedEventAt;
    const comp = obj(arr(ev.competitions)[0]);
    const competitors = arr(comp.competitors).map(obj);
    const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
    const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
    const homeTeam = obj(home.team);
    const awayTeam = obj(away.team);
    const statusObj = obj(comp.status);
    const status = statusFromState(str(obj(statusObj.type).state));

    // Form: per-team most-recent 5 results as a 5-char W/D/L string,
    // oldest first. ESPN's scoreboard puts this directly on each
    // competitor object (not inside records[]). We capture it in the
    // outer teamForm map so the standings view can attach it later.
    for (const rawC of competitors) {
      const c = obj(rawC);
      const tid = str(obj(c.team).id);
      const form = str(c.form);
      const previous = teamForm.get(tid);
      if (tid && form && (!previous || eventAt > previous.eventAt)) {
        teamForm.set(tid, { value: form, eventAt });
      }
    }

    // goals: scoring plays from competition.details, split by team id.
    // Build ScorerEntry records so the /player/[id] page can find
    // goals by athlete id (not by name matching).
    const homeId = str(homeTeam.id);
    const homeScorers: ScorerEntry[] = [];
    const awayScorers: ScorerEntry[] = [];
    for (const rawDetail of arr(comp.details)) {
      const d = obj(rawDetail);
      if (!d.scoringPlay) continue;
      const athlete = obj(arr(d.athletesInvolved)[0]);
      const id = str(athlete.id);
      const name = str(athlete.displayName) || str(athlete.shortName);
      if (!id || !name) continue;
      const typeText = str(obj(d.type).text);
      const minute = str(obj(d.clock).displayValue);
      const tag = typeText.toLowerCase().includes('own')
        ? ' (OG)'
        : typeText.toLowerCase().includes('penalty')
          ? ' (p)'
          : '';
      const entry: ScorerEntry = { playerId: id, name, minute, tag };
      (str(obj(d.team).id) === homeId ? homeScorers : awayScorers).push(entry);
    }

    const venue = obj(comp.venue);
    const city = str(obj(venue.address).city);
    const venueName = str(venue.fullName);
    const date = str(ev.date);
    const kickoff = date ? new Date(date) : null;

    // Winner side (ESPN flags it on the competitor). Only meaningful for
    // finished matches; resolves penalty-shootout winners where the
    // regulation/ET score is level. Undefined for draws / unfinished.
    const winner =
      status === 'finished'
        ? home.winner === true
          ? 'home'
          : away.winner === true
            ? 'away'
            : undefined
        : undefined;

    // Knockout decider: penalty score (ESPN competitor.shootoutScore) and
    // how the match ended (status.type.name → STATUS_FINAL_PEN / _AET).
    // The aggregate home/awayScore stays the regulation+ET score, so a
    // pens match reads as level until we surface these.
    const homeShootout = typeof home.shootoutScore === 'number' ? home.shootoutScore : null;
    const awayShootout = typeof away.shootoutScore === 'number' ? away.shootoutScore : null;
    const typeName = str(obj(statusObj.type).name).toUpperCase();
    const finishType: 'aet' | 'pens' | undefined =
      status !== 'finished'
        ? undefined
        : homeShootout != null && awayShootout != null
          ? 'pens'
          : typeName.includes('AET')
            ? 'aet'
            : undefined;

    // Richer status: clock, displayClock, period (only set for live/finished).
    const progress =
      status === 'upcoming'
        ? undefined
        : progressFromStatus({
            clock: Number(statusObj.clock) || 0,
            displayClock: str(statusObj.displayClock),
            type: {
              state: str(obj(statusObj.type).state),
              period: Number(obj(statusObj.type).period) || 0,
            },
            // Some ESPN responses put period at the top level of `status`.
            period: Number(statusObj.period) || 0,
          });

    return {
      id: str(ev.id),
      homeName: str(homeTeam.displayName),
      awayName: str(awayTeam.displayName),
      homeFlag: teamLogo(homeTeam),
      awayFlag: teamLogo(awayTeam),
      homeId: homeId,
      awayId: str(awayTeam.id),
      homeScore: status === 'upcoming' ? null : parseScore(home.score),
      awayScore: status === 'upcoming' ? null : parseScore(away.score),
      kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null,
      status,
      homeScorers: status === 'upcoming' ? [] : homeScorers,
      awayScorers: status === 'upcoming' ? [] : awayScorers,
      venue: venueName && city ? `${venueName} · ${city}` : venueName,
      slug: matchSlug(str(homeTeam.displayName), str(awayTeam.displayName), str(ev.id)),
      odds: parseScoreboardOdds(comp.odds),
      ...(progress ? { progress } : {}),
      ...(winner ? { winner } : {}),
      ...(finishType ? { finishType } : {}),
      ...(finishType === 'pens' && homeShootout != null && awayShootout != null
        ? { homeShootoutScore: homeShootout, awayShootoutScore: awayShootout }
        : {}),
    };
  });

  // Form is collected from the scoreboard (it isn't on the standings
  // feed). Attach it to each standing row after the scoreboard has
  // populated teamForm.
  for (const g of gr) {
    for (const s of g.standings) {
      const form = teamForm.get(s.teamId)?.value;
      if (form) s.form = form;
    }
  }

  // --- top scorers ---
  // NOTE: the ONLY remaining consumer of this `scorers` output is the player
  // page (SSR, via getCompetitionView) for a name/goals lookup. It is a
  // SEPARATE path from the right-rail leaders pipeline (useLeaders /
  // getLeaderboards) — don't assume the two scorers feeds are the same.
  // Count EVERY scoring play, so any player who scores ranks — not just each
  // team's single ESPN "leader" (the old source listed one leader per team per
  // match, silently dropping everyone else). We reuse the goals already parsed
  // onto each match (homeScorers/awayScorers from competition.details), one
  // ScorerEntry per goal, and tally per athlete across the whole tournament.
  // Own goals don't count toward the scorer; penalties do. Team name/flag come
  // from the standings map, falling back to the match's own values.
  const teamMap = new Map<string, string>();
  const teamFlagMap = new Map<string, string>();
  for (const g of gr) {
    for (const s of g.standings) {
      teamMap.set(s.teamId, s.name);
      teamFlagMap.set(s.teamId, s.flag);
    }
  }
  const scorerMap = new Map<string, TopScorer>();
  for (const m of ms) {
    const sides = [
      { entries: m.homeScorers, teamId: m.homeId, name: m.homeName, flag: m.homeFlag },
      { entries: m.awayScorers, teamId: m.awayId, name: m.awayName, flag: m.awayFlag },
    ];
    for (const side of sides) {
      for (const e of side.entries) {
        if (e.tag === ' (OG)') continue; // own goal → credited to the team, not this player
        const existing = scorerMap.get(e.playerId);
        if (existing) {
          existing.goals += 1;
        } else {
          scorerMap.set(e.playerId, {
            athleteId: e.playerId,
            name: e.name,
            teamId: side.teamId,
            teamName: teamMap.get(side.teamId) || side.name,
            teamFlag: teamFlagMap.get(side.teamId) || side.flag,
            goals: 1,
          });
        }
      }
    }
  }
  const sc: TopScorer[] = [...scorerMap.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, 50);

  return { matches: ms, standings: { kind: 'soccer', groups: gr }, scorers: sc };
}

function transformSummary(json: unknown): MatchDetail {
  const d = obj(json);
  const base = parseSummaryBase(d);

  const allPlays: PlayEvent[] = arr(d.commentary).map((raw) => {
    const c = obj(raw);
    return { clock: str(obj(c.time).displayValue), text: str(c.text), teamId: null, type: '' };
  });
  const keyPlays: PlayEvent[] = arr(d.keyEvents)
    .filter((k) => str(obj(k).text))
    .map((raw) => {
      const k = obj(raw);
      return {
        clock: str(obj(k.clock).displayValue),
        text: str(k.text),
        teamId: str(obj(k.team).id) || null,
        type: str(obj(k.type).text),
      };
    });

  const lineups: TeamLineup[] = arr(d.rosters).map((raw): TeamLineup => {
    const r = obj(raw);
    const team = obj(r.team);
    const players: LineupPlayer[] = arr(r.roster).map((rawP): LineupPlayer => {
      const p = obj(rawP);
      const plays = arr(p.plays);
      const sub = subClock(plays);
      return {
        jersey: str(p.jersey),
        name: str(obj(p.athlete).displayName),
        pos: str(obj(p.position).abbreviation),
        starter: Boolean(p.starter),
        ...(p.subbedIn && sub ? { subbedInAt: sub } : {}),
        ...(p.subbedOut && sub ? { subbedOutAt: sub } : {}),
        ...(cardOf(plays) ? { card: cardOf(plays) } : {}),
      };
    });
    return {
      teamId: str(team.id),
      teamName: str(team.displayName),
      formation: str(r.formation),
      players,
    };
  });
  // Enforce the [home, away] contract regardless of ESPN roster order.
  const rank = (l: TeamLineup) => (l.teamId === base.homeId ? 0 : l.teamId === base.awayId ? 1 : 2);
  lineups.sort((a, b) => rank(a) - rank(b));

  return {
    kind: 'soccer',
    homeId: base.homeId,
    awayId: base.awayId,
    stats: base.teamStats,
    allPlays,
    keyPlays,
    lineups,
    venue: base.venue,
    attendance: base.attendance,
    odds: base.odds,
    form: base.form,
  };
}

export const soccerAdapter: SportAdapter = { transform, transformSummary };
