import { type SQL, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type PendingRow = {
  id: number;
  profightdb_id: number | null;
  profightdb_slug: string | null;
  printed_name: string;
  other_printed_names: string | null;
  occurrence_count: number;
  first_seen_date: string | null;
  last_seen_date: string | null;
  resolved_wrestler_id: number | null;
  resolved_name: string | null;
  merged: boolean;
};

export type PendingFilters = {
  q?: string;
  show?: "open" | "merged" | "all";
  page?: number;
  perPage?: number;
};

export type PendingListResult = {
  rows: PendingRow[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  counts: { open: number; merged: number };
};

export async function listPending(db: Db, filters: PendingFilters): Promise<PendingListResult> {
  const perPage = filters.perPage ?? 50;
  const page = Math.max(1, filters.page ?? 1);
  const show = filters.show ?? "open";

  const conds: SQL[] = [];
  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(sql`(printed_name ILIKE ${like} OR other_printed_names ILIKE ${like})`);
  }
  if (show === "open") conds.push(sql`resolved_wrestler_id IS NULL`);
  if (show === "merged") conds.push(sql`resolved_wrestler_id IS NOT NULL`);
  const whereSql = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const totalRows = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM v_pending_wrestlers_queue ${whereSql}`,
  );
  const total = totalRows[0]?.n ?? 0;

  const offset = (page - 1) * perPage;
  const rows = await db.execute<PendingRow>(sql`
    SELECT * FROM v_pending_wrestlers_queue ${whereSql}
     ORDER BY merged ASC, occurrence_count DESC, printed_name
     LIMIT ${perPage} OFFSET ${offset}
  `);

  const [openCount, mergedCount] = await Promise.all([
    db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM pending_wrestlers WHERE resolved_wrestler_id IS NULL`,
    ),
    db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM pending_wrestlers WHERE resolved_wrestler_id IS NOT NULL`,
    ),
  ]);

  return {
    rows: [...rows],
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    counts: { open: openCount[0]?.n ?? 0, merged: mergedCount[0]?.n ?? 0 },
  };
}

export type PendingDetail = PendingRow & {
  raw: {
    id: number;
    normalized_name: string | null;
    notes: string | null;
  };
  samples: Array<{
    entry_id: number;
    publication_date: string | null;
    issue_number: string | null;
    list_label: string;
    list_scope: string;
    rank: number;
    entry_name: string;
    source_url: string | null;
  }>;
  suggestions: Array<{
    id: number;
    primary_ring_name: string;
    other_ring_names: string | null;
    debut_year: number | null;
    primary_role: string | null;
  }>;
  allWrestlers: Array<{ id: number; primary_ring_name: string }>;
};

export async function getPendingDetail(db: Db, pid: number): Promise<PendingDetail | null> {
  const headRows = await db.execute<PendingRow>(
    sql`SELECT * FROM v_pending_wrestlers_queue WHERE id = ${pid}`,
  );
  const head = headRows[0];
  if (!head) return null;

  const rawRows = await db.execute<{
    id: number;
    normalized_name: string | null;
    notes: string | null;
  }>(sql`SELECT id, normalized_name, notes FROM pending_wrestlers WHERE id = ${pid}`);
  const raw = rawRows[0];

  const samples = await db.execute<PendingDetail["samples"][number]>(sql`
    SELECT re.id AS entry_id, pi.publication_date, pi.issue_number, rl.list_label,
           rl.list_scope, re.rank, re.entry_name, rl.source_url
      FROM ranking_entries re
      JOIN ranking_lists rl ON re.ranking_list_id = rl.id
      JOIN periodical_issues pi ON rl.issue_id = pi.id
     WHERE re.pending_wrestler_id = ${pid}
     ORDER BY pi.publication_date DESC
     LIMIT 25
  `);

  const norm = (raw.normalized_name ?? "").trim();
  let suggestions: PendingDetail["suggestions"] = [];
  if (norm) {
    const like = `%${norm}%`;
    const r = await db.execute<PendingDetail["suggestions"][number]>(sql`
      SELECT id, primary_ring_name, other_ring_names, debut_year, primary_role
        FROM wrestlers
       WHERE LOWER(primary_ring_name) LIKE ${like}
          OR LOWER(other_ring_names) LIKE ${like}
       ORDER BY primary_ring_name
       LIMIT 8
    `);
    suggestions = [...r];
    if (suggestions.length === 0) {
      const tokens = norm.split(/\s+/).filter((t) => t.length > 2);
      const last = tokens[tokens.length - 1];
      if (last) {
        const lastLike = `%${last}%`;
        const r2 = await db.execute<PendingDetail["suggestions"][number]>(sql`
          SELECT id, primary_ring_name, other_ring_names, debut_year, primary_role
            FROM wrestlers
           WHERE LOWER(primary_ring_name) LIKE ${lastLike}
              OR LOWER(other_ring_names) LIKE ${lastLike}
           ORDER BY primary_ring_name
           LIMIT 8
        `);
        suggestions = [...r2];
      }
    }
  }

  const allWrestlers = await db.execute<{ id: number; primary_ring_name: string }>(
    sql`SELECT id, primary_ring_name FROM wrestlers ORDER BY primary_ring_name`,
  );

  return {
    ...head,
    raw,
    samples: [...samples],
    suggestions,
    allWrestlers: [...allWrestlers],
  };
}
