// Pure, defensive parse of ESPN's site.api team endpoints (teams/{id} +
// /roster + /schedule) plus the league injuries feed into one TeamDetail.
// Sport-agnostic: soccer and basketball share these shapes. No DOM/React.
import type { RosterPlayer, TeamDetail, TeamGame, TeamInjury } from './types';
import { arr, obj, str } from './utils/coerce';

function parseRoster(rosterJson: unknown): RosterPlayer[] {
  return arr(obj(rosterJson).athletes)
    .map(obj)
    .map(
      (a): RosterPlayer => ({
        id: str(a.id),
        name: str(a.displayName),
        jersey: str(a.jersey),
        position: str(obj(a.position).abbreviation),
      }),
    )
    .filter((p) => p.name);
}

function parseSchedule(scheduleJson: unknown): TeamGame[] {
  return arr(obj(scheduleJson).events)
    .map(obj)
    .map((e): TeamGame => {
      const comp = obj(arr(e.competitions)[0]);
      const scores = arr(comp.competitors)
        .map(obj)
        .map((c) => str(obj(c.score).displayValue) || str(c.score))
        .filter(Boolean);
      const status = str(obj(obj(comp.status).type).shortDetail);
      return {
        id: str(e.id),
        date: str(e.date),
        name: str(e.name) || str(e.shortName),
        detail: scores.length === 2 ? scores.join(' - ') : status,
      };
    })
    .filter((g) => g.name);
}

// League injuries feed is grouped per team ({ id, displayName, injuries[] }).
// Exported separately so the data layer can cache the FILTERED result per team
// (the raw league feed is ~1MB for NBA — parse+filter once per TTL, not per render).
export function parseTeamInjuries(injuriesJson: unknown, teamId: string): TeamInjury[] {
  return arr(obj(injuriesJson).injuries)
    .map(obj)
    .filter((g) => str(g.id) === teamId)
    .flatMap((g) => arr(g.injuries).map(obj))
    .map(
      (i): TeamInjury => ({
        name: str(obj(i.athlete).displayName),
        status: str(i.status),
        detail: str(i.shortComment),
      }),
    )
    .filter((i) => i.name);
}

// Team header + roster + schedule. Injuries are attached by the data layer
// (see parseTeamInjuries) so they can be cached per team.
export function parseTeamDetail(
  teamJson: unknown,
  rosterJson: unknown,
  scheduleJson: unknown,
  teamId: string,
): TeamDetail {
  const t = obj(obj(teamJson).team);
  return {
    id: str(t.id) || teamId,
    name: str(t.displayName),
    logo: str(obj(arr(t.logos)[0]).href),
    record: str(obj(arr(obj(t.record).items)[0]).summary),
    standingSummary: str(t.standingSummary),
    roster: parseRoster(rosterJson),
    schedule: parseSchedule(scheduleJson),
    injuries: [],
  };
}
