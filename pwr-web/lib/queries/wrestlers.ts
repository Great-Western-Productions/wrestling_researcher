import { type SQL, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import type { BookRow } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type WrestlerRow = {
  id: number;
  legal_name: string | null;
  primary_ring_name: string;
  other_ring_names: string | null;
  born_date: string | null;
  died_date: string | null;
  living: boolean | null;
  debut_year: number | null;
  retired_year: number | null;
  primary_role: string | null;
  hometown_billed: string | null;
  hometown_real: string | null;
  finisher: string | null;
  style: string | null;
  socials: string | null;
  convention_status: string | null;
  last_known_appearance: string | null;
  footage_notes: string | null;
  midcard_files_status: string | null;
  midcard_files_priority: number | null;
  why_they_mattered: string | null;
  notes: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  bio: string | null;
  cagematch_id: string | null;
  cagematch_url: string | null;
  created_at: string | null;
};

export type WrestlerFilters = {
  q?: string;
  role?: string;
  living?: "1" | "0";
  territoryId?: number;
  status?: string;
  sort?: "name" | "debut" | "born" | "priority";
};

export type WrestlerListResult = {
  rows: WrestlerRow[];
  total: number;
  roles: string[];
  statuses: string[];
  territories: Array<{ id: number; name: string; short_name: string | null }>;
};

const SORT_MAP: Record<NonNullable<WrestlerFilters["sort"]>, SQL> = {
  name: sql`w.primary_ring_name`,
  debut: sql`w.debut_year NULLS LAST, w.primary_ring_name`,
  born: sql`w.born_date NULLS LAST, w.primary_ring_name`,
  priority: sql`w.midcard_files_priority NULLS LAST, w.primary_ring_name`,
};

export async function listWrestlers(db: Db, filters: WrestlerFilters): Promise<WrestlerListResult> {
  const sort = filters.sort ?? "name";

  const conds: SQL[] = [];
  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      sql`(w.primary_ring_name ILIKE ${like} OR w.legal_name ILIKE ${like} OR w.other_ring_names ILIKE ${like})`,
    );
  }
  if (filters.role) conds.push(sql`w.primary_role = ${filters.role}`);
  if (filters.living === "1") conds.push(sql`w.living = true`);
  if (filters.living === "0") conds.push(sql`w.living = false`);
  if (filters.status) conds.push(sql`w.midcard_files_status = ${filters.status}`);

  const joinSql = filters.territoryId
    ? sql`JOIN wrestler_territory_runs r ON r.wrestler_id = w.id`
    : sql``;
  if (filters.territoryId) conds.push(sql`r.territory_id = ${filters.territoryId}`);

  const whereSql = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = await db.execute<WrestlerRow>(sql`
    SELECT DISTINCT w.* FROM wrestlers w
    ${joinSql}
    ${whereSql}
    ORDER BY ${SORT_MAP[sort]}
  `);

  const [roles, statuses, territoriesList] = await Promise.all([
    distinctValues(db, "wrestlers", "primary_role"),
    distinctValues(db, "wrestlers", "midcard_files_status"),
    db.execute<{ id: number; name: string; short_name: string | null }>(
      sql`SELECT id, name, short_name FROM territories ORDER BY name`,
    ),
  ]);

  return {
    rows: [...rows],
    total: rows.length,
    roles,
    statuses,
    territories: [...territoriesList],
  };
}

export async function getWrestlerById(db: Db, id: number): Promise<WrestlerRow | null> {
  const rows = await db.execute<WrestlerRow>(sql`SELECT * FROM wrestlers WHERE id = ${id}`);
  return rows[0] ?? null;
}

export type WrestlerRun = {
  id: number;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  role_during_run: string | null;
  ring_name_during_run: string | null;
  primary_run: boolean | null;
  notes: string | null;
  tid: number;
  terr_name: string;
  terr_short: string | null;
  terr_region: string | null;
};

export async function runsForWrestler(db: Db, wrestlerId: number): Promise<WrestlerRun[]> {
  const rows = await db.execute<WrestlerRun>(sql`
    SELECT r.id, r.start_year, r.start_month, r.end_year, r.end_month,
           r.role_during_run, r.ring_name_during_run, r.primary_run, r.notes,
           t.id AS tid, t.name AS terr_name, t.short_name AS terr_short, t.region AS terr_region
      FROM wrestler_territory_runs r
      JOIN territories t ON t.id = r.territory_id
     WHERE r.wrestler_id = ${wrestlerId}
     ORDER BY r.start_year NULLS LAST
  `);
  return [...rows];
}

export type WrestlerCitation = {
  id: number;
  page: string | null;
  excerpt: string | null;
  book_id: number;
  book_title: string;
  book_year: number | null;
};

export async function citationsForWrestler(
  db: Db,
  wrestlerId: number,
): Promise<WrestlerCitation[]> {
  const rows = await db.execute<WrestlerCitation>(sql`
    SELECT c.id, c.page, c.excerpt,
           b.id AS book_id, b.title AS book_title, b.year_published AS book_year
      FROM wrestler_book_citations c
      JOIN books b ON b.id = c.book_id
     WHERE c.wrestler_id = ${wrestlerId}
     ORDER BY b.year_published NULLS LAST, b.title
  `);
  return [...rows];
}

export async function relatedBooksForWrestler(
  db: Db,
  wrestlerName: string,
  limit = 50,
): Promise<BookRow[]> {
  const like = `%${wrestlerName}%`;
  const rows = await db.execute<BookRow>(sql`
    SELECT DISTINCT b.* FROM books b
      LEFT JOIN book_authors ba ON ba.book_id = b.id
      LEFT JOIN authors a ON a.id = ba.author_id
     WHERE b.subject_wrestler ILIKE ${like} OR a.name ILIKE ${like}
     ORDER BY b.year_published DESC NULLS LAST
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
