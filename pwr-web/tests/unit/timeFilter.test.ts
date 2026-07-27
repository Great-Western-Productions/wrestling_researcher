import { describe, expect, it } from 'vitest';
import type { TerritoryMapData } from '@/lib/map/config';
import {
  assignmentsAsOf,
  contestedActiveIn,
  frameFor,
  marketsActiveIn,
  territoriesActiveIn,
} from '@/lib/map/timeFilter';

const T = {
  a: { id: 'a', name: 'Alpha', color: '#a00', startYear: 1960, endYear: 1980 },
  b: { id: 'b', name: 'Bravo', color: '#0a0', startYear: 1970, endYear: 1990 },
};

const data: TerritoryMapData = {
  territories: [T.a, T.b],
  assignments: [
    { fips: '01001', territoryId: 'a', fromYear: 1960, toYear: 1974 },
    { fips: '01001', territoryId: 'b', fromYear: 1975, toYear: 1990 }, // changes hands
    { fips: '02002', territoryId: 'a', fromYear: 1960, toYear: 1980 },
  ],
  markets: [
    {
      id: 'city1',
      name: 'Shared City',
      lat: 30,
      lon: -95,
      territoryIds: ['a', 'b'],
      startYear: 1965,
      endYear: 1985,
    },
    {
      id: 'city2',
      name: 'Solo City',
      lat: 31,
      lon: -96,
      territoryIds: ['a'],
      startYear: 1960,
      endYear: 1968,
    },
  ],
  contested: [
    {
      id: 'z1',
      geometry: { type: 'Polygon', coordinates: [] },
      territoryIds: ['a', 'b'],
      fromYear: 1972,
      toYear: 1978,
    },
  ],
};

describe('territoriesActiveIn', () => {
  it('includes only territories whose lifespan covers the year', () => {
    expect(territoriesActiveIn(1965, data.territories).map((t) => t.id)).toEqual(['a']);
    expect(territoriesActiveIn(1975, data.territories).map((t) => t.id)).toEqual(['a', 'b']);
    expect(territoriesActiveIn(1985, data.territories).map((t) => t.id)).toEqual(['b']);
  });
});

describe('assignmentsAsOf', () => {
  it('resolves county ownership for the year', () => {
    expect(assignmentsAsOf(1970, data.assignments).get('01001')).toBe('a');
    expect(assignmentsAsOf(1980, data.assignments).get('01001')).toBe('b');
  });
  it('drops counties whose assignment window excludes the year', () => {
    // 02002 ends 1980, so absent in 1985
    expect(assignmentsAsOf(1985, data.assignments).has('02002')).toBe(false);
  });
  it('when windows overlap, the later fromYear wins (deterministic)', () => {
    const overlap = [
      { fips: '09009', territoryId: 'a', fromYear: 1960, toYear: 1980 },
      { fips: '09009', territoryId: 'b', fromYear: 1970, toYear: 1980 },
    ];
    expect(assignmentsAsOf(1975, overlap).get('09009')).toBe('b');
  });
});

describe('marketsActiveIn', () => {
  it('keeps markets live in the year, narrowed to owners active then', () => {
    // 1972: both a and b active, shared city co-owned
    const m72 = marketsActiveIn(1972, data.markets, data.territories);
    expect(m72.map((m) => m.id)).toEqual(['city1']);
    expect(m72[0].territoryIds).toEqual(['a', 'b']);
  });
  it('narrows a shared market to the single owner still active', () => {
    // 1967: only a active; shared city shows a only (single marker)
    const m67 = marketsActiveIn(1967, data.markets, data.territories);
    const shared = m67.find((m) => m.id === 'city1');
    expect(shared?.territoryIds).toEqual(['a']);
  });
  it('excludes markets outside their own lifespan', () => {
    expect(marketsActiveIn(1975, data.markets, data.territories).map((m) => m.id)).toEqual([
      'city1',
    ]);
  });
});

describe('marketsActiveIn with tenures', () => {
  // city1 is tenured: 'a' runs it 1965-1969, then 'b' takes over 1970-1985.
  const tenures = [
    { marketId: 'city1', territoryId: 'a', fromYear: 1965, toYear: 1969, tier: 'Primary' as const },
    { marketId: 'city1', territoryId: 'b', fromYear: 1970, toYear: 1985, tier: 'Secondary' as const },
  ];

  it('resolves owners per year from tenures, overriding static territoryIds', () => {
    const m67 = marketsActiveIn(1967, data.markets, data.territories, tenures);
    expect(m67.find((m) => m.id === 'city1')?.territoryIds).toEqual(['a']);

    const m75 = marketsActiveIn(1975, data.markets, data.territories, tenures);
    expect(m75.find((m) => m.id === 'city1')?.territoryIds).toEqual(['b']);
  });

  it('takes tier from the tenure row, so a market can change tier by year', () => {
    expect(marketsActiveIn(1967, data.markets, data.territories, tenures)
      .find((m) => m.id === 'city1')?.tier).toBe('Primary');
    expect(marketsActiveIn(1975, data.markets, data.territories, tenures)
      .find((m) => m.id === 'city1')?.tier).toBe('Secondary');
  });

  it('drops a tenured market in years no tenure covers', () => {
    // city1's static span starts 1965, but no tenure covers 1990
    expect(marketsActiveIn(1990, data.markets, data.territories, tenures)
      .some((m) => m.id === 'city1')).toBe(false);
  });

  it('leaves untenured markets on their static fields', () => {
    // city2 has no tenure rows, so it still uses startYear/endYear + owners
    const m1965 = marketsActiveIn(1965, data.markets, data.territories, tenures);
    expect(m1965.find((m) => m.id === 'city2')?.territoryIds).toEqual(['a']);
  });

  it('honours a tenure before its territory is formally constituted', () => {
    // 'b' is not active until 1970, but an authored 1965-69 tenure means it
    // toured that market first: the dot shows with no county fill behind it.
    // (GWA 1957: six Rio Grande markets, territory constituted in 1958.)
    const early = [
      { marketId: 'city1', territoryId: 'b', fromYear: 1965, toYear: 1969 },
    ];
    const m67 = marketsActiveIn(1967, data.markets, data.territories, early);
    expect(m67.find((m) => m.id === 'city1')?.territoryIds).toEqual(['b']);
  });
});

describe('frameFor legend coverage', () => {
  it('lists a territory that only has market presence, so its dots are explained', () => {
    const early = [
      { marketId: 'city1', territoryId: 'b', fromYear: 1965, toYear: 1969 },
    ];
    const frame = frameFor(1967, { ...data, tenures: early });
    // 'b' is not active in 1967, but it has a market there
    expect(frame.territories.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(frame.ownership.size).toBeGreaterThan(0);
  });
});

describe('contestedActiveIn', () => {
  it('filters by the zone window and tolerates undefined', () => {
    expect(contestedActiveIn(1975, data.contested).map((z) => z.id)).toEqual(['z1']);
    expect(contestedActiveIn(1969, data.contested)).toEqual([]);
    expect(contestedActiveIn(1975, undefined)).toEqual([]);
  });
});

describe('frameFor', () => {
  it('assembles a full frame for a year', () => {
    const f = frameFor(1975, data);
    expect(f.year).toBe(1975);
    expect(f.territories.map((t) => t.id)).toEqual(['a', 'b']);
    expect(f.ownership.get('01001')).toBe('b');
    expect(f.markets.map((m) => m.id)).toEqual(['city1']);
    expect(f.contested.map((z) => z.id)).toEqual(['z1']);
  });
});
