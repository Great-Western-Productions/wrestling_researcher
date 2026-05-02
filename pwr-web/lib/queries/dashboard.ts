import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type DashboardCounts = {
  books: number;
  periodicals: number;
  authors: number;
  wrestlerAuthors: number;
  territories: number;
  wrestlers: number;
  byCategory: Record<string, number>;
  byConfidence: Record<string, number>;
};

export async function getDashboardCounts(db: Db): Promise<DashboardCounts> {
  const [
    booksCount,
    periodicalsCount,
    authorsCount,
    wrestlerAuthorsCount,
    territoriesCount,
    wrestlersCount,
    byCategoryRows,
    byConfidenceRows,
  ] = await Promise.all([
    db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM books`),
    db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM periodicals`),
    db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM authors`),
    db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM authors WHERE is_wrestler = 1`,
    ),
    db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM territories`),
    db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM wrestlers`),
    db.execute<{ category_code: string; n: number }>(
      sql`SELECT category_code, COUNT(*)::int AS n FROM books GROUP BY category_code`,
    ),
    db.execute<{ confidence: string | null; n: number }>(
      sql`SELECT confidence, COUNT(*)::int AS n FROM books GROUP BY confidence`,
    ),
  ]);

  const byCategory: Record<string, number> = {};
  for (const r of byCategoryRows) byCategory[r.category_code] = r.n;
  const byConfidence: Record<string, number> = {};
  for (const r of byConfidenceRows) {
    if (r.confidence) byConfidence[r.confidence] = r.n;
  }

  return {
    books: booksCount[0]?.n ?? 0,
    periodicals: periodicalsCount[0]?.n ?? 0,
    authors: authorsCount[0]?.n ?? 0,
    wrestlerAuthors: wrestlerAuthorsCount[0]?.n ?? 0,
    territories: territoriesCount[0]?.n ?? 0,
    wrestlers: wrestlersCount[0]?.n ?? 0,
    byCategory,
    byConfidence,
  };
}

export type TopAuthor = {
  id: number;
  name: string;
  isWrestler: boolean;
  bookCount: number;
};

export async function getTopAuthors(db: Db, limit: number): Promise<TopAuthor[]> {
  const rows = await db.execute<{
    id: number;
    name: string;
    is_wrestler: number | null;
    n: number;
  }>(sql`
    SELECT a.id, a.name, a.is_wrestler, COUNT(*)::int AS n
      FROM authors a
      JOIN book_authors ba ON ba.author_id = a.id
     GROUP BY a.id, a.name, a.is_wrestler
     ORDER BY n DESC, a.name
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isWrestler: r.is_wrestler === 1,
    bookCount: r.n,
  }));
}

export type DecadeBucket = { decade: number; count: number };

export async function getBooksByDecade(db: Db): Promise<DecadeBucket[]> {
  const rows = await db.execute<{ decade: number; n: number }>(sql`
    SELECT (year_published / 10) * 10 AS decade, COUNT(*)::int AS n
      FROM books
     WHERE year_published IS NOT NULL
     GROUP BY decade
     ORDER BY decade
  `);
  return rows.map((r) => ({ decade: r.decade, count: r.n }));
}

export type FeaturedTerritory = {
  id: number;
  name: string;
  shortName: string | null;
  region: string | null;
  yearFounded: number | null;
  yearClosed: number | null;
  runCount: number;
};

export async function getFeaturedTerritories(
  db: Db,
  limit: number,
): Promise<FeaturedTerritory[]> {
  const rows = await db.execute<{
    id: number;
    name: string;
    short_name: string | null;
    region: string | null;
    year_founded: number | null;
    year_closed: number | null;
    run_count: number;
  }>(sql`
    SELECT t.id, t.name, t.short_name, t.region, t.year_founded, t.year_closed,
           COUNT(r.id)::int AS run_count
      FROM territories t
      LEFT JOIN wrestler_territory_runs r ON r.territory_id = t.id
     GROUP BY t.id
     ORDER BY run_count DESC, t.name
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    region: r.region,
    yearFounded: r.year_founded,
    yearClosed: r.year_closed,
    runCount: r.run_count,
  }));
}
