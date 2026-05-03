import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type MergeBooksResult = {
  targetId: number;
  duplicateId: number;
  /** Rows newly inserted into book_authors for the target. */
  authorsCopied: number;
  /** Number of target columns that were NULL/empty and got filled from the duplicate. */
  fieldsFilled: number;
};

type FillableSpec = { col: string; type: "text" | "int" };

// Mirrors the Python merge_books semantics in tests/test_book_merge.py:
// confidence and category_code are intentionally excluded (curator-set on target).
const FILLABLE_BOOK_COLS: FillableSpec[] = [
  { col: "subtitle", type: "text" },
  { col: "publisher", type: "text" },
  { col: "year_published", type: "int" },
  { col: "isbn10", type: "text" },
  { col: "isbn13", type: "text" },
  { col: "pages", type: "int" },
  { col: "format", type: "text" },
  { col: "language", type: "text" },
  { col: "country", type: "text" },
  { col: "subject_wrestler", type: "text" },
  { col: "era", type: "text" },
  { col: "territory_or_promotion", type: "text" },
  { col: "synopsis", type: "text" },
  { col: "source_url", type: "text" },
  { col: "primary_source_value", type: "text" },
];

function isBlank(value: unknown, type: FillableSpec["type"]): boolean {
  if (value === null || value === undefined) return true;
  if (type === "text" && value === "") return true;
  return false;
}

export async function mergeBooks(
  db: Db,
  targetId: number,
  duplicateId: number,
): Promise<MergeBooksResult> {
  if (targetId === duplicateId) {
    throw new Error("Cannot merge a book with the same book.");
  }
  return db.transaction(async (tx) => {
    const targetRows = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM books WHERE id = ${targetId}`,
    );
    const dupRows = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM books WHERE id = ${duplicateId}`,
    );
    if (!targetRows[0]) throw new Error(`Target book ${targetId} not found.`);
    if (!dupRows[0]) throw new Error(`Duplicate book ${duplicateId} not found.`);
    const target = targetRows[0];
    const duplicate = dupRows[0];

    const copied = await tx.execute<{ id: number }>(sql`
      INSERT INTO book_authors (book_id, author_id, role)
      SELECT ${targetId}, author_id, role FROM book_authors WHERE book_id = ${duplicateId}
      ON CONFLICT DO NOTHING
      RETURNING book_id AS id
    `);
    const authorsCopied = copied.length;

    await tx.execute(sql`DELETE FROM books WHERE id = ${duplicateId}`);

    let fieldsFilled = 0;
    for (const { col, type } of FILLABLE_BOOK_COLS) {
      if (!isBlank(target[col], type)) continue;
      if (isBlank(duplicate[col], type)) continue;
      const colSql = sql.raw(`"${col}"`);
      await tx.execute(sql`
        UPDATE books
           SET ${colSql} = ${duplicate[col] as string | number},
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${targetId}
      `);
      fieldsFilled++;
    }

    return { targetId, duplicateId, authorsCopied, fieldsFilled };
  });
}
