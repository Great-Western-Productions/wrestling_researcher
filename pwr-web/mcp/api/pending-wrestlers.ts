import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { normalizeName } from "@/mcp/api/dedup";

type Db = PostgresJsDatabase<typeof schema>;

export type PendingWrestlerRow = {
  id: number;
  printed_name: string;
  normalized_name: string;
  profightdb_id: number | null;
  occurrence_count: number;
  resolved_wrestler_id: number | null;
};

export type ResolveResult = {
  pendingId: number;
  wrestlerId: number;
  rankingEntriesBackfilled: number;
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

export async function resolvePendingTo(
  db: Db,
  pendingId: number,
  wrestlerId: number,
): Promise<ResolveResult> {
  return db.transaction(async (tx) => {
    const pendingRows = await tx.execute<{ id: number }>(
      sql`SELECT id FROM pending_wrestlers WHERE id = ${pendingId}`,
    );
    if (!pendingRows[0]) throw new Error(`Pending wrestler ${pendingId} not found.`);
    const wrestlerRows = await tx.execute<{ id: number }>(
      sql`SELECT id FROM wrestlers WHERE id = ${wrestlerId}`,
    );
    if (!wrestlerRows[0]) throw new Error(`Wrestler ${wrestlerId} not found.`);

    await tx.execute(sql`
      UPDATE pending_wrestlers
         SET resolved_wrestler_id = ${wrestlerId},
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ${pendingId}
    `);
    const updated = await tx.execute<{ id: number }>(sql`
      UPDATE ranking_entries
         SET wrestler_id = ${wrestlerId}, pending_wrestler_id = NULL
       WHERE pending_wrestler_id = ${pendingId}
      RETURNING 1 AS id
    `);
    return {
      pendingId,
      wrestlerId,
      rankingEntriesBackfilled: updated.length,
    };
  });
}

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
    const r = await resolvePendingTo(tx, pendingId, newId);
    return {
      pendingId,
      wrestlerId: newId,
      rankingEntriesBackfilled: r.rankingEntriesBackfilled,
    };
  });
}

// Re-export for completeness on the API surface.
export { normalizeName };
