import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { ValidationError } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

// Fields that get filled from the duplicate when the target's value is blank.
const BOOK_MERGE_FILL_FIELDS = [
  "subtitle",
  "category_code",
  "publisher",
  "year_published",
  "isbn10",
  "isbn13",
  "pages",
  "format",
  "language",
  "country",
  "subject_wrestler",
  "era",
  "territory_or_promotion",
  "synopsis",
  "source_url",
  "confidence",
  "primary_source_value",
] as const;

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Merge `duplicateBookId` into `targetBookId`. Preserves target values when present;
 *  fills in target's blank fields from the duplicate; merges author links; deletes
 *  the duplicate row. */
export async function mergeBooks(
  db: Db,
  targetBookId: number,
  duplicateBookId: number,
): Promise<void> {
  if (targetBookId === duplicateBookId) {
    throw new ValidationError("Cannot merge a book into the same book.");
  }

  await db.transaction(async (tx) => {
    const both = await tx.execute<Record<string, unknown> & { id: number }>(
      sql`SELECT * FROM books WHERE id IN (${targetBookId}, ${duplicateBookId})`,
    );
    if (both.length !== 2) {
      throw new ValidationError("Both books must exist before they can be merged.");
    }
    const target = both.find((r) => r.id === targetBookId)!;
    const duplicate = both.find((r) => r.id === duplicateBookId)!;

    // Move author links from duplicate to target (skipping ones target already has).
    await tx.execute(sql`
      INSERT INTO book_authors (book_id, author_id, role)
      SELECT ${targetBookId}, author_id, role FROM book_authors WHERE book_id = ${duplicateBookId}
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`DELETE FROM books WHERE id = ${duplicateBookId}`);

    // Fill target blanks from duplicate.
    const updates: ReturnType<typeof sql>[] = [];
    for (const field of BOOK_MERGE_FILL_FIELDS) {
      if (isBlank(target[field]) && !isBlank(duplicate[field])) {
        updates.push(sql`${sql.identifier(field)} = ${duplicate[field]}`);
      }
    }
    if (updates.length > 0) {
      await tx.execute(sql`
        UPDATE books SET ${sql.join(updates, sql`, `)}
         WHERE id = ${targetBookId}
      `);
    }
  });
}

export type PendingMergeResult = {
  rankingEntriesBackfilled: number;
  pendingPrintedName: string;
  wrestlerName: string;
};

/** Link a pending wrestler row to an existing curated wrestler and backfill any
 *  ranking_entries that were pointing at the pending row. */
export async function mergePendingIntoWrestler(
  db: Db,
  pendingId: number,
  wrestlerId: number,
): Promise<PendingMergeResult> {
  return db.transaction(async (tx) => {
    const pendings = await tx.execute<{ printed_name: string }>(
      sql`SELECT printed_name FROM pending_wrestlers WHERE id = ${pendingId}`,
    );
    if (pendings.length === 0) throw new ValidationError("Pending wrestler not found.");
    const wrestlers = await tx.execute<{ primary_ring_name: string }>(
      sql`SELECT primary_ring_name FROM wrestlers WHERE id = ${wrestlerId}`,
    );
    if (wrestlers.length === 0) throw new ValidationError("Target wrestler not found.");

    await tx.execute(
      sql`UPDATE pending_wrestlers SET resolved_wrestler_id = ${wrestlerId} WHERE id = ${pendingId}`,
    );
    const updated = await tx.execute<{ count: number }>(sql`
      WITH updated AS (
        UPDATE ranking_entries
           SET wrestler_id = ${wrestlerId}, pending_wrestler_id = NULL
         WHERE pending_wrestler_id = ${pendingId}
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM updated
    `);

    return {
      rankingEntriesBackfilled: updated[0]?.count ?? 0,
      pendingPrintedName: pendings[0]!.printed_name,
      wrestlerName: wrestlers[0]!.primary_ring_name,
    };
  });
}

/** Undo a previous pending→wrestler merge: clear resolved_wrestler_id and detach
 *  ranking_entries that match the original printed_name. */
export async function unmergePendingFromWrestler(
  db: Db,
  pendingId: number,
): Promise<{ rankingEntriesReverted: number; printedName: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      resolved_wrestler_id: number | null;
      printed_name: string;
    }>(sql`
      SELECT resolved_wrestler_id, printed_name
        FROM pending_wrestlers WHERE id = ${pendingId}
    `);
    const head = rows[0];
    if (!head || !head.resolved_wrestler_id) {
      throw new ValidationError("Nothing to undo.");
    }
    const wid = head.resolved_wrestler_id;

    await tx.execute(
      sql`UPDATE pending_wrestlers SET resolved_wrestler_id = NULL WHERE id = ${pendingId}`,
    );
    const reverted = await tx.execute<{ count: number }>(sql`
      WITH reverted AS (
        UPDATE ranking_entries
           SET wrestler_id = NULL, pending_wrestler_id = ${pendingId}
         WHERE wrestler_id = ${wid}
           AND entry_name = ${head.printed_name}
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM reverted
    `);

    return {
      rankingEntriesReverted: reverted[0]?.count ?? 0,
      printedName: head.printed_name,
    };
  });
}
