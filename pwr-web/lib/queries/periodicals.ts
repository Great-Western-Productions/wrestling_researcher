import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type PeriodicalRow = {
  id: number;
  title: string;
  publisher: string | null;
  country: string | null;
  language: string | null;
  year_started: number | null;
  year_ended: number | null;
  frequency: string | null;
  type: string | null;
  parent_company: string | null;
  notes: string | null;
  issue_count_known: number | null;
  archive_in_collection: boolean | null;
  source_url: string | null;
  confidence: string | null;
  created_at: string | null;
};

export type PeriodicalFilters = {
  country?: string;
  type?: string;
  inArchive?: boolean;
};

export type PeriodicalListResult = {
  rows: PeriodicalRow[];
  total: number;
  countries: string[];
  types: string[];
};

export async function listPeriodicals(
  db: Db,
  filters: PeriodicalFilters,
): Promise<PeriodicalListResult> {
  const conds: SQL[] = [];
  if (filters.country) conds.push(sql`country = ${filters.country}`);
  if (filters.type) conds.push(sql`type = ${filters.type}`);
  if (filters.inArchive) conds.push(sql`archive_in_collection = true`);
  const whereSql = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = await db.execute<PeriodicalRow>(sql`
    SELECT * FROM periodicals ${whereSql}
     ORDER BY country, year_started, title
  `);

  const [countries, types] = await Promise.all([
    distinctValues(db, "periodicals", "country"),
    distinctValues(db, "periodicals", "type"),
  ]);

  return { rows: [...rows], total: rows.length, countries, types };
}

async function distinctValues(db: Db, table: string, column: string): Promise<string[]> {
  const rows = await db.execute<{ v: string }>(
    sql`SELECT DISTINCT ${sql.identifier(column)} AS v FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} IS NOT NULL ORDER BY ${sql.identifier(column)}`,
  );
  return rows.map((r) => r.v);
}
