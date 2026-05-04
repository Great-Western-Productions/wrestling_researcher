import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import type { Confidence } from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type AboutCounts = {
  books: number | null;
  periodicals: number | null;
  authors: number | null;
  territories: number | null;
  wrestlers: number | null;
  runs: number | null;
  factions: number | null;
  issues: number | null;
  rankingLists: number | null;
  rankingEntries: number | null;
  byConfidence: Record<string, number>;
};

async function safeCount(db: Db, table: string): Promise<number | null> {
  try {
    const rows = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(table)}`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}

export async function getAboutCounts(db: Db): Promise<AboutCounts> {
  const [
    books,
    periodicals,
    authorsCount,
    territories,
    wrestlers,
    runs,
    factions,
    issues,
    rankingLists,
    rankingEntries,
  ] = await Promise.all([
    safeCount(db, "books"),
    safeCount(db, "periodicals"),
    safeCount(db, "authors"),
    safeCount(db, "territories"),
    safeCount(db, "wrestlers"),
    safeCount(db, "wrestler_territory_runs"),
    safeCount(db, "factions"),
    safeCount(db, "periodical_issues"),
    safeCount(db, "ranking_lists"),
    safeCount(db, "ranking_entries"),
  ]);

  const confRows = await db.execute<{ confidence: Confidence | null; n: number }>(
    sql`SELECT confidence, COUNT(*)::int AS n FROM books GROUP BY confidence`,
  );
  const byConfidence: Record<string, number> = {};
  for (const r of confRows) {
    if (r.confidence) byConfidence[r.confidence] = r.n;
  }

  return {
    books,
    periodicals,
    authors: authorsCount,
    territories,
    wrestlers,
    runs,
    factions,
    issues,
    rankingLists,
    rankingEntries,
    byConfidence,
  };
}
