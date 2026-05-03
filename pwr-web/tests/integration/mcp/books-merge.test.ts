import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { categories } from "@/lib/db/schema";
import { insertBook } from "@/lib/db-ops/books";
import { mergeBooks } from "@/mcp/api/books";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

const baseBook = {
  title: "Placeholder",
  subtitle: null as string | null,
  category_code: "by_wrestler",
  publisher: null as string | null,
  year_published: null as number | null,
  isbn10: null as string | null,
  isbn13: null as string | null,
  pages: null as number | null,
  format: null as string | null,
  language: "English",
  country: null as string | null,
  subject_wrestler: null as string | null,
  era: null as string | null,
  territory_or_promotion: null as string | null,
  synopsis: null as string | null,
  source_url: null as string | null,
  confidence: "medium" as const,
  authorNames: [] as string[],
  authorsAreWrestlers: false,
};

async function seedCategory(tx: Parameters<Parameters<typeof withTx>[0]>[0]) {
  await tx
    .insert(categories)
    .values({ code: "by_wrestler", label: "By a wrestler" })
    .onConflictDoNothing();
}

describe("mergeBooks", () => {
  it("rejects merging a book with itself", async () => {
    await withTx(async (tx) => {
      await expect(mergeBooks(tx, 1, 1)).rejects.toThrow(/same book/i);
    });
  });

  it("fills NULL/empty target columns from duplicate but never overwrites populated ones", async () => {
    await withTx(async (tx) => {
      await seedCategory(tx);
      const targetId = await insertBook(tx, {
        ...baseBook,
        title: "Accepted: How I Learned to Stop Worrying and Love the Ring",
        subtitle: null,
        publisher: "", // empty string counts as blank
        year_published: 2014,
        isbn13: null,
        confidence: "medium",
      });
      const dupId = await insertBook(tx, {
        ...baseBook,
        title: "Accepted",
        subtitle: "How I Learned to Stop Worrying and Love the Ring",
        publisher: "ECW Press",
        year_published: 2014,
        isbn13: "9781770411617",
        confidence: "high",
      });

      await mergeBooks(tx, targetId, dupId);

      const rows = await tx.execute<{
        title: string;
        subtitle: string | null;
        publisher: string | null;
        isbn13: string | null;
        confidence: string;
      }>(
        sql`SELECT title, subtitle, publisher, isbn13, confidence FROM books WHERE id = ${targetId}`,
      );
      expect(rows[0]).toMatchObject({
        title: "Accepted: How I Learned to Stop Worrying and Love the Ring",
        subtitle: "How I Learned to Stop Worrying and Love the Ring",
        publisher: "ECW Press",
        isbn13: "9781770411617",
        confidence: "medium",
      });
    });
  });

  it("copies authors from duplicate to target idempotently and deletes the duplicate row", async () => {
    await withTx(async (tx) => {
      await seedCategory(tx);
      const targetId = await insertBook(tx, {
        ...baseBook,
        title: "Target Edition",
        authorNames: ["Mick Foley"],
      });
      const dupId = await insertBook(tx, {
        ...baseBook,
        title: "Duplicate Edition",
        authorNames: ["Mick Foley", "Larry Csonka"],
      });

      const result = await mergeBooks(tx, targetId, dupId);

      const authorRows = await tx.execute<{ name: string }>(sql`
        SELECT a.name FROM book_authors ba
          JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ${targetId}
         ORDER BY a.name
      `);
      expect(authorRows.map((r) => r.name)).toEqual(["Larry Csonka", "Mick Foley"]);

      const dupRows = await tx.execute<{ id: number }>(
        sql`SELECT id FROM books WHERE id = ${dupId}`,
      );
      expect(dupRows).toHaveLength(0);

      expect(result).toMatchObject({
        targetId,
        duplicateId: dupId,
        authorsCopied: 1, // only Larry Csonka was new on target
        fieldsFilled: 0,
      });
    });
  });

  it("returns the count of fields it actually filled", async () => {
    await withTx(async (tx) => {
      await seedCategory(tx);
      const targetId = await insertBook(tx, {
        ...baseBook,
        title: "T",
        year_published: 2000,
        publisher: null,
        synopsis: null,
        isbn13: null,
      });
      const dupId = await insertBook(tx, {
        ...baseBook,
        title: "T",
        year_published: 1999,
        publisher: "ECW Press",
        synopsis: "About wrestling.",
        isbn13: "9780000000000",
      });

      const result = await mergeBooks(tx, targetId, dupId);
      expect(result.fieldsFilled).toBe(3);
    });
  });
});
