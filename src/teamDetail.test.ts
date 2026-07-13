import { describe, expect, it } from 'vitest';
import { parseTeamDetail, parseTeamInjuries } from './teamDetail';

const teamJson = {
  team: {
    id: '1',
    displayName: 'Atlanta Hawks',
    logos: [{ href: 'atl.png' }],
    record: { items: [{ summary: '46-36' }] },
    standingSummary: '5th in Eastern Conference',
  },
};
const rosterJson = {
  athletes: [
    { id: 'a1', displayName: 'Trae Young', jersey: '11', position: { abbreviation: 'G' } },
    { id: 'a2', displayName: '', jersey: '0', position: {} }, // no name → dropped
  ],
};
const scheduleJson = {
  events: [
    {
      id: 'g1',
      date: '2026-04-18T22:00Z',
      name: 'Atlanta Hawks at New York Knicks',
      competitions: [
        {
          competitors: [{ score: { displayValue: '101' } }, { score: { displayValue: '99' } }],
          status: { type: { shortDetail: 'Final' } },
        },
      ],
    },
    {
      id: 'g2',
      shortName: 'ATL @ BOS',
      date: '2026-04-20T22:00Z',
      competitions: [{ competitors: [], status: { type: { shortDetail: 'Scheduled' } } }],
    },
  ],
};

describe('parseTeamDetail', () => {
  it('parses header, roster (dropping nameless) and schedule (score or status)', () => {
    const d = parseTeamDetail(teamJson, rosterJson, scheduleJson, '1');
    expect(d).toMatchObject({
      id: '1',
      name: 'Atlanta Hawks',
      logo: 'atl.png',
      record: '46-36',
      standingSummary: '5th in Eastern Conference',
      injuries: [],
    });
    expect(d.roster).toEqual([{ id: 'a1', name: 'Trae Young', jersey: '11', position: 'G' }]);
    expect(d.schedule[0]).toEqual({
      id: 'g1',
      date: '2026-04-18T22:00Z',
      name: 'Atlanta Hawks at New York Knicks',
      detail: '101 - 99',
    });
    expect(d.schedule[1].detail).toBe('Scheduled'); // no scores → status text
  });

  it('is defensive on junk', () => {
    expect(parseTeamDetail(null, null, null, 'x').name).toBe('');
    expect(parseTeamDetail(null, null, null, 'x').roster).toEqual([]);
  });
});

describe('parseTeamInjuries', () => {
  const injuriesJson = {
    injuries: [
      {
        id: '1',
        displayName: 'Atlanta Hawks',
        injuries: [
          { athlete: { displayName: 'Jalen Johnson' }, status: 'Out', shortComment: 'foot' },
        ],
      },
      {
        id: '2',
        displayName: 'Boston Celtics',
        injuries: [{ athlete: { displayName: 'Other Guy' }, status: 'Day-To-Day' }],
      },
    ],
  };

  it('filters to the requested team and maps athlete/status/detail', () => {
    expect(parseTeamInjuries(injuriesJson, '1')).toEqual([
      { name: 'Jalen Johnson', status: 'Out', detail: 'foot' },
    ]);
  });

  it('returns [] for an unknown team or junk', () => {
    expect(parseTeamInjuries(injuriesJson, '999')).toEqual([]);
    expect(parseTeamInjuries({}, '1')).toEqual([]);
  });
});
