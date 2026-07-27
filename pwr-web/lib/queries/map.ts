import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * A promotion the map can draw, with its eras folded in.
 *
 * A null map_color is the switch that keeps a row off the map, which is how
 * the sanctioning bodies and the joint ventures stay off it: the National
 * Wrestling Alliance sanctioned a world champion and never ran a card, so it
 * has no turf to colour.
 */
export type MapTerritoryRow = {
  id: number;
  name: string;
  map_color: string;
  region: string | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  country: string | null;
  lineage_key: string | null;
  start_year: number;
  end_year: number;
  /** Union of every state any era of this promotion held. */
  states: string[];
  eras: Array<{
    from_year: number;
    to_year: number | null;
    states: string[] | null;
    promotion_name: string | null;
    promoter: string | null;
    nwa_member: boolean | null;
    confidence: string | null;
  }>;
};

export type MapMarketRow = {
  id: number;
  name: string;
  state: string;
  country: string;
  lat: number;
  lon: number;
};

export type MapRunRow = {
  market_id: number;
  territory_id: number;
  from_year: number;
  to_year: number | null;
  tier: "Primary" | "Secondary" | "Tertiary" | null;
  confidence: string | null;
};

/**
 * Only promotions that have a colour and at least one era. An era at `low`
 * confidence is dropped from the fill path: a footprint that rests on nothing
 * is a border invented out of thin air, and the map should not draw it. Those
 * promotions still reach the map through their markets and draw as markers.
 */
export async function territoriesForMap(db: Db, clampTo: number): Promise<MapTerritoryRow[]> {
  const rows = await db.execute<MapTerritoryRow>(sql`
    SELECT
      t.id,
      t.name,
      t.map_color,
      t.region,
      t.headquarters_city,
      t.headquarters_state,
      t.country,
      t.lineage_key,
      min(e.from_year)::int                                   AS start_year,
      max(COALESCE(e.to_year, ${clampTo}))::int               AS end_year,
      COALESCE(
        (SELECT array_agg(DISTINCT s)
           FROM territory_eras e2
           CROSS JOIN LATERAL unnest(e2.states) AS s
          WHERE e2.territory_id = t.id
            AND e2.confidence IS DISTINCT FROM 'low'),
        ARRAY[]::text[]
      )                                                       AS states,
      json_agg(
        json_build_object(
          'from_year',      e.from_year,
          'to_year',        e.to_year,
          'states',         e.states,
          'promotion_name', e.promotion_name,
          'promoter',       e.promoter,
          'nwa_member',     e.nwa_member,
          'confidence',     e.confidence
        ) ORDER BY e.from_year
      )                                                       AS eras
    FROM territories t
    JOIN territory_eras e ON e.territory_id = t.id
    WHERE t.map_color IS NOT NULL
    GROUP BY t.id
    ORDER BY t.name
  `);
  return rows as unknown as MapTerritoryRow[];
}

/** Every town any drawable promotion ran. Null coordinates draw nothing. */
export async function marketsForMap(db: Db): Promise<MapMarketRow[]> {
  const rows = await db.execute<MapMarketRow>(sql`
    SELECT DISTINCT m.id, m.name, m.state, m.country, m.lat, m.lon
    FROM markets m
    JOIN territory_market_runs r ON r.market_id = m.id
    JOIN territories t          ON t.id = r.territory_id
    WHERE m.lat IS NOT NULL
      AND m.lon IS NOT NULL
      AND t.map_color IS NOT NULL
    ORDER BY m.name
  `);
  return rows as unknown as MapMarketRow[];
}

/** One row per market run. This maps onto MarketTenure field for field. */
export async function marketRunsForMap(db: Db): Promise<MapRunRow[]> {
  const rows = await db.execute<MapRunRow>(sql`
    SELECT r.market_id, r.territory_id, r.from_year, r.to_year, r.tier, r.confidence
    FROM territory_market_runs r
    JOIN territories t ON t.id = r.territory_id
    JOIN markets m     ON m.id = r.market_id
    WHERE t.map_color IS NOT NULL
      AND m.lat IS NOT NULL
      AND m.lon IS NOT NULL
    ORDER BY r.territory_id, r.market_id, r.from_year
  `);
  return rows as unknown as MapRunRow[];
}
