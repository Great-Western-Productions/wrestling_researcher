/**
 * Pure year -> visible-features helpers. No MapLibre, no DOM: this is the
 * layer the renderer and the video exporter both call, and the layer the
 * unit tests cover.
 */
import type {
  ContestedZone,
  CountyAssignment,
  Market,
  MarketTenure,
  MarketTier,
  Territory,
  TerritoryMapData,
} from "./config";

const inSpan = (year: number, from: number, to: number): boolean => year >= from && year <= to;

export function territoriesActiveIn(year: number, territories: Territory[]): Territory[] {
  return territories.filter((t) => inSpan(year, t.startYear, t.endYear));
}

/**
 * Tier 1: resolve county ownership as of `year`. Returns fips -> territoryId.
 * If two assignments for the same fips overlap `year` (a data error), the
 * later `fromYear` wins so the map still renders deterministically.
 */
export function assignmentsAsOf(
  year: number,
  assignments: CountyAssignment[],
): Map<string, string> {
  const chosen = new Map<string, CountyAssignment>();
  for (const a of assignments) {
    if (!inSpan(year, a.fromYear, a.toYear)) continue;
    const prev = chosen.get(a.fips);
    if (!prev || a.fromYear > prev.fromYear) chosen.set(a.fips, a);
  }
  const out = new Map<string, string>();
  for (const [fips, a] of chosen) out.set(fips, a.territoryId);
  return out;
}

/**
 * Tier 2: markets live in `year`, each narrowed to its owners active then.
 *
 * When `tenures` are supplied, any market that has tenure rows resolves its
 * owners (and tier) from them, so ownership can change year to year. Markets
 * with no tenure rows keep using their static lifespan and owner list, which
 * lets a partly authored dataset render without gaps.
 */
export function marketsActiveIn(
  year: number,
  markets: Market[],
  territories: Territory[],
  tenures?: MarketTenure[],
): Market[] {
  const liveTerritoryIds = new Set(territoriesActiveIn(year, territories).map((t) => t.id));

  // marketId -> { owners, tier } as of this year, plus the set of markets that
  // have any tenure row at all (those opt out of the static fallback).
  const owners = new Map<string, { ids: string[]; tier?: MarketTier }>();
  const tenured = new Set<string>();
  for (const t of tenures ?? []) {
    tenured.add(t.marketId);
    if (!inSpan(year, t.fromYear, t.toYear)) continue;
    // A tenure row is authored per year, so it is the authority for that year
    // and does not require the territory to be formally constituted. This is
    // how a promotion that toured a market before it held territory still puts
    // dots on the map, with no county fill behind them.
    const entry = owners.get(t.marketId) ?? { ids: [], tier: undefined };
    if (!entry.ids.includes(t.territoryId)) entry.ids.push(t.territoryId);
    // Primary anywhere that year sizes the marker as primary.
    if (t.tier === "Primary" || entry.tier == null) entry.tier = t.tier;
    owners.set(t.marketId, entry);
  }

  const out: Market[] = [];
  for (const m of markets) {
    if (tenured.has(m.id)) {
      const entry = owners.get(m.id);
      if (!entry || entry.ids.length === 0) continue;
      out.push({ ...m, territoryIds: entry.ids, tier: entry.tier ?? m.tier });
      continue;
    }
    if (!inSpan(year, m.startYear, m.endYear)) continue;
    const ids = m.territoryIds.filter((id) => liveTerritoryIds.has(id));
    if (ids.length === 0) continue;
    out.push({ ...m, territoryIds: ids });
  }
  return out;
}

/** Tier 3: contested overlays active in `year`. */
export function contestedActiveIn(year: number, contested: ContestedZone[] = []): ContestedZone[] {
  return contested.filter((z) => inSpan(year, z.fromYear, z.toYear));
}

export interface FrameData {
  year: number;
  territories: Territory[];
  /** fips -> territoryId for the Tier-1 fill. */
  ownership: Map<string, string>;
  markets: Market[];
  contested: ContestedZone[];
}

/** Everything the renderer needs to paint a single year. */
export function frameFor(year: number, data: TerritoryMapData): FrameData {
  const markets = marketsActiveIn(year, data.markets, data.territories, data.tenures);

  // Formally constituted territories, plus any that only have market presence
  // this year, so every dot on the map has a legend entry explaining it.
  const shown = new Map(territoriesActiveIn(year, data.territories).map((t) => [t.id, t]));
  for (const m of markets) {
    for (const id of m.territoryIds) {
      if (shown.has(id)) continue;
      const t = data.territories.find((x) => x.id === id);
      if (t) shown.set(id, t);
    }
  }

  return {
    year,
    territories: [...shown.values()],
    ownership: assignmentsAsOf(year, data.assignments),
    markets,
    contested: contestedActiveIn(year, data.contested),
  };
}
