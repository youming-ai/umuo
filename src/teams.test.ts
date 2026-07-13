import { describe, expect, it } from 'vitest';
import { parseTeams } from './teams';

const payload = {
  sports: [
    {
      leagues: [
        {
          teams: [
            {
              team: {
                id: '2',
                displayName: 'Zebras FC',
                abbreviation: 'ZEB',
                logos: [{ href: 'z.png' }],
                color: '112233',
              },
            },
            {
              team: {
                id: '1',
                displayName: 'Alpha United',
                abbreviation: 'ALP',
                logos: [{ href: 'a.png' }],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('parseTeams', () => {
  it('flattens sports[].leagues[].teams[].team and sorts by name', () => {
    const teams = parseTeams(payload);
    expect(teams.map((t) => t.name)).toEqual(['Alpha United', 'Zebras FC']);
    expect(teams[0]).toEqual({
      id: '1',
      name: 'Alpha United',
      abbrev: 'ALP',
      logo: 'a.png',
      color: '',
    });
    expect(teams[1].logo).toBe('z.png');
  });

  it('is defensive on junk / missing fields', () => {
    expect(parseTeams(null)).toEqual([]);
    expect(parseTeams({})).toEqual([]);
    // a team entry with no id is dropped
    expect(parseTeams({ sports: [{ leagues: [{ teams: [{ team: {} }] }] }] })).toEqual([]);
  });
});
