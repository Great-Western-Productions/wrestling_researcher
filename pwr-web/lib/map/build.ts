/**
 * Database rows to the shape the renderer eats.
 *
 * The published map rebuilds a JSON artifact with a script and ships it. This
 * one queries on request behind a cache, so a market run entered in the app
 * moves the border on the next page load. That freshness is the reason the map
 * lives inside the research app at all.
 */
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db/client";
import {
  marketRunsForMap,
  marketsForMap,
  type MapTerritoryRow,
  territoriesForMap,
} from "@/lib/queries/map";
import { assignCounties, DEFAULT_CAP_KM, loadUnits } from "./assign";
import type { BaseGeography, Market, MarketTenure, Territory, TerritoryMapData } from "./config";

/** The closed window this map covers. Nothing about it moves. */
export const MAP_START_YEAR = 1925;
export const MAP_END_YEAR = 1995;

export const MAP_CACHE_TAG = "map-data";

/** Renders a promotion's eras into one line for the detail panel. */
function describeEras(t: MapTerritoryRow): string {
  return t.eras
    .map((e) => {
      const to = e.to_year ?? MAP_END_YEAR;
      const who = e.promoter ?? e.promotion_name ?? "";
      const span = e.from_year === to ? `${e.from_year}` : `${e.from_year}–${to}`;
      return who ? `${span} ${who}` : span;
    })
    .join(" · ");
}

async function build(): Promise<TerritoryMapData> {
  // module-scope client, same as the other pages

  const [terrRows, marketRows, runRows] = await Promise.all([
    territoriesForMap(db, MAP_END_YEAR),
    marketsForMap(db),
    marketRunsForMap(db),
  ]);

  const territories: Territory[] = terrRows.map((t) => ({
    id: String(t.id),
    name: t.name,
    color: t.map_color,
    startYear: t.start_year,
    endYear: t.end_year,
    meta: {
      promotion: t.eras.at(-1)?.promotion_name ?? t.name,
      hub: [t.headquarters_city, t.headquarters_state].filter(Boolean).join(", ") || undefined,
      region: t.region ?? undefined,
      eras: describeEras(t),
      lineage: t.lineage_key ?? undefined,
    },
  }));

  // Tenures are the authored truth. A market's static territoryIds and lifespan
  // are the envelope of its runs, so a renderer path that ignores tenures still
  // draws something sane.
  const tenures: MarketTenure[] = runRows.map((r) => ({
    marketId: String(r.market_id),
    territoryId: String(r.territory_id),
    fromYear: r.from_year,
    toYear: r.to_year ?? MAP_END_YEAR,
    tier: r.tier ?? undefined,
  }));

  const runsByMarket = new Map<number, typeof runRows>();
  for (const r of runRows) {
    const list = runsByMarket.get(r.market_id);
    if (list) list.push(r);
    else runsByMarket.set(r.market_id, [r]);
  }

  const TIER_RANK = { Primary: 3, Secondary: 2, Tertiary: 1 } as const;

  const markets: Market[] = marketRows.map((m) => {
    const runs = runsByMarket.get(m.id) ?? [];
    const owners = [...new Set(runs.map((r) => String(r.territory_id)))];
    // The market's headline tier is the highest any owner ever gave it, so a
    // town that was somebody's home arena reads as one even if a later office
    // only passed through.
    let tier: Market["tier"];
    let rank = 0;
    for (const r of runs) {
      const k = r.tier ? TIER_RANK[r.tier] : 0;
      if (k > rank) {
        rank = k;
        tier = r.tier ?? undefined;
      }
    }
    return {
      id: String(m.id),
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      territoryIds: owners,
      tier,
      startYear: runs.length ? Math.min(...runs.map((r) => r.from_year)) : MAP_START_YEAR,
      endYear: runs.length
        ? Math.max(...runs.map((r) => r.to_year ?? MAP_END_YEAR))
        : MAP_END_YEAR,
      meta: { state: m.state, country: m.country },
    };
  });

  const geography: BaseGeography = "us-counties";
  const units = await loadUnits(geography);

  const marketById = new Map(marketRows.map((m) => [m.id, m]));
  const assignments = assignCounties(
    terrRows.map((t) => ({
      id: String(t.id),
      states: t.states ?? [],
      startYear: t.start_year,
      endYear: t.end_year,
    })),
    runRows.flatMap((r) => {
      const m = marketById.get(r.market_id);
      if (!m) return [];
      return [
        {
          territoryId: String(r.territory_id),
          lon: m.lon,
          lat: m.lat,
          fromYear: r.from_year,
          toYear: r.to_year ?? MAP_END_YEAR,
        },
      ];
    }),
    units,
    { startYear: MAP_START_YEAR, endYear: MAP_END_YEAR, capKm: DEFAULT_CAP_KM },
  );

  return { territories, assignments, markets, tenures };
}

/**
 * Cold cost is the geometry parse plus the sweep, under a second at full
 * corpus scale. Warm is a memory read. Revalidate MAP_CACHE_TAG from anything
 * that writes a territory, era, market or run.
 */
export const buildMapData = unstable_cache(build, ["territory-map-data"], {
  tags: [MAP_CACHE_TAG],
});
