import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import type { BookRow } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type TerritoryRow = {
  id: number;
  name: string;
  short_name: string | null;
  region: string | null;
  nwa_member: boolean | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  year_founded: number | null;
  year_closed: number | null;
  promoter_lineage: string | null;
  notes: string | null;
  cagematch_id: string | null;
  country: string | null;
  aliases: string | null;
  cagematch_url: string | null;
  created_at: string | null;
};

export type TerritoryListItem = TerritoryRow & { run_count: number };

export type TerritoryFilters = {
  region?: string;
  nwa?: "1" | "0";
  q?: string;
};

export type TerritoryListResult = {
  rows: TerritoryListItem[];
  total: number;
  regions: string[];
};

export async function listTerritories(
  db: Db,
  filters: TerritoryFilters,
): Promise<TerritoryListResult> {
  const conds: SQL[] = [];
  if (filters.region) conds.push(sql`t.region = ${filters.region}`);
  if (filters.nwa === "1") conds.push(sql`t.nwa_member = true`);
  if (filters.nwa === "0") conds.push(sql`t.nwa_member = false`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      sql`(t.name ILIKE ${like} OR t.short_name ILIKE ${like} OR t.headquarters_city ILIKE ${like})`,
    );
  }
  const whereSql = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = await db.execute<TerritoryListItem>(sql`
    SELECT t.*,
           (SELECT COUNT(*)::int FROM wrestler_territory_runs r WHERE r.territory_id = t.id) AS run_count
      FROM territories t
      ${whereSql}
     ORDER BY t.region, t.year_founded, t.name
  `);

  const regions = await distinctValues(db, "territories", "region");

  return { rows: [...rows], total: rows.length, regions };
}

export async function getTerritoryById(db: Db, id: number): Promise<TerritoryRow | null> {
  const rows = await db.execute<TerritoryRow>(
    sql`SELECT * FROM territories WHERE id = ${id}`,
  );
  return rows[0] ?? null;
}

export type TerritoryRun = {
  id: number;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  role_during_run: string | null;
  ring_name_during_run: string | null;
  primary_run: boolean | null;
  notes: string | null;
  wid: number;
  primary_ring_name: string;
  legal_name: string | null;
  primary_role: string | null;
  midcard_files_status: string | null;
  midcard_files_priority: number | null;
};

export async function runsForTerritory(db: Db, territoryId: number): Promise<TerritoryRun[]> {
  const rows = await db.execute<TerritoryRun>(sql`
    SELECT r.id, r.start_year, r.start_month, r.end_year, r.end_month,
           r.role_during_run, r.ring_name_during_run, r.primary_run, r.notes,
           w.id AS wid, w.primary_ring_name, w.legal_name, w.primary_role,
           w.midcard_files_status, w.midcard_files_priority
      FROM wrestler_territory_runs r
      JOIN wrestlers w ON w.id = r.wrestler_id
     WHERE r.territory_id = ${territoryId}
     ORDER BY r.start_year NULLS LAST, w.primary_ring_name
  `);
  return [...rows];
}

export async function relatedBooksForTerritory(
  db: Db,
  territory: { name: string; short_name: string | null },
  limit = 50,
): Promise<BookRow[]> {
  const nameLike = `%${territory.name}%`;
  const shortLike = `%${territory.short_name ?? territory.name}%`;
  const rows = await db.execute<BookRow>(sql`
    SELECT * FROM books
     WHERE territory_or_promotion ILIKE ${nameLike}
        OR territory_or_promotion ILIKE ${shortLike}
     ORDER BY year_published DESC NULLS LAST
     LIMIT ${limit}
  `);
  return [...rows];
}

async function distinctValues(db: Db, table: string, column: string): Promise<string[]> {
  const rows = await db.execute<{ v: string }>(
    sql`SELECT DISTINCT ${sql.identifier(column)} AS v FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} IS NOT NULL ORDER BY ${sql.identifier(column)}`,
  );
  return rows.map((r) => r.v);
}
