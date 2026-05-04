import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { mergePendingIntoWrestler } from "./merge";

type Db = PostgresJsDatabase<typeof schema>;

export type PendingWrestlerRow = {
  id: number;
  printed_name: string;
  normalized_name: string;
  profightdb_id: number | null;
  occurrence_count: number;
  resolved_wrestler_id: number | null;
};

export type PromoteResult = {
  pendingId: number;
  wrestlerId: number;
  rankingEntriesBackfilled: number;
};

export async function listPendingWrestlers(
  db: Db,
  opts: { resolved?: boolean; limit?: number } = {},
): Promise<PendingWrestlerRow[]> {
  const limit = opts.limit ?? 50;
  const where =
    opts.resolved === true
      ? sql`resolved_wrestler_id IS NOT NULL`
      : opts.resolved === false
        ? sql`resolved_wrestler_id IS NULL`
        : sql`TRUE`;
  return db.execute<PendingWrestlerRow>(sql`
    SELECT id, printed_name, normalized_name, profightdb_id, occurrence_count, resolved_wrestler_id
      FROM pending_wrestlers
     WHERE ${where}
     ORDER BY occurrence_count DESC, id ASC
     LIMIT ${limit}
  `);
}

/**
 * Promote a pending row into a brand new canonical wrestler. Creates the
 * `wrestlers` row, then delegates to `mergePendingIntoWrestler` (the shared
 * resolve-and-backfill helper) so the same code path applies whether the
 * curator picks an existing wrestler or spins up a new one.
 */
export async function promotePending(db: Db, pendingId: number): Promise<PromoteResult> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ printed_name: string }>(
      sql`SELECT printed_name FROM pending_wrestlers WHERE id = ${pendingId}`,
    );
    if (!rows[0]) throw new Error(`Pending wrestler ${pendingId} not found.`);
    const inserted = await tx.execute<{ id: number }>(sql`
      INSERT INTO wrestlers (primary_ring_name, midcard_files_status)
      VALUES (${rows[0].printed_name}, 'queued')
      RETURNING id
    `);
    const newId = inserted[0]!.id;
    const r = await mergePendingIntoWrestler(tx, pendingId, newId);
    return {
      pendingId,
      wrestlerId: newId,
      rankingEntriesBackfilled: r.rankingEntriesBackfilled,
    };
  });
}

// Re-export the shared resolve helper so MCP can wire `pendingWrestlers.resolveTo`
// to the same function the HTTP server-action `pendingMergeAction` uses.
export { mergePendingIntoWrestler as resolvePendingTo } from "./merge";
