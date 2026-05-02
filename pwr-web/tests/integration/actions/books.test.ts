import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { authors, book_authors, books, categories } from "@/lib/db/schema";
import { insertBook, updateBook, type BookInput } from "@/lib/db-ops/books";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

function makeInput(overrides: Partial<BookInput> = {}): BookInput {
  return {
    title: "Test Book",
    subtitle: null,
    category_code: "x",
    publisher: null,
    year_published: null,
    isbn10: null,
    isbn13: null,
    pages: null,
    format: null,
    language: "English",
    country: null,
    subject_wrestler: null,
    era: null,
    territory_or_promotion: null,
    synopsis: null,
    source_url: null,
    confidence: "medium",
    authorNames: [],
    authorsAreWrestlers: false,
    ...overrides,
  };
}

describe("insertBook", () => {
  it("creates a book with new and existing authors", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      // Pre-existing author should be reused, not duplicated.
      await tx.insert(authors).values({ name: "Existing Author" });

      const id = await insertBook(tx, makeInput({
        title: "My Book",
        authorNames: ["Existing Author", "New Author"],
      }));

      const links = await tx.execute<{ name: string; is_wrestler: number | null }>(sql`
        SELECT a.name, a.is_wrestler
          FROM book_authors ba JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ${id}
         ORDER BY a.name
      `);
      const authorRows = await tx.execute<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM authors`,
      );
      return { links: [...links], totalAuthors: authorRows[0]?.n ?? 0 };
    });

    expect(result.links.map((l) => l.name)).toEqual(["Existing Author", "New Author"]);
    expect(result.totalAuthors).toBe(2);
  });

  it("flags new authors as wrestlers when requested", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      await insertBook(tx, makeInput({
        authorNames: ["Wrestling Author"],
        authorsAreWrestlers: true,
      }));
      const rows = await tx.execute<{ is_wrestler: number | null }>(
        sql`SELECT is_wrestler FROM authors WHERE name = 'Wrestling Author'`,
      );
      return rows[0]?.is_wrestler;
    });
    expect(result).toBe(true);
  });
});

describe("updateBook", () => {
  it("updates fields and re-syncs authors (removes ones not in the new list)", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      const id = await insertBook(tx, makeInput({
        title: "Old Title",
        authorNames: ["Alice", "Bob"],
      }));
      await updateBook(tx, id, makeInput({
        title: "New Title",
        confidence: "high",
        authorNames: ["Bob", "Carol"],
      }));
      const book = await tx.execute<{ title: string; confidence: string | null }>(
        sql`SELECT title, confidence FROM books WHERE id = ${id}`,
      );
      const linkedAuthors = await tx.execute<{ name: string }>(sql`
        SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ${id} ORDER BY a.name
      `);
      return { book: book[0], authors: [...linkedAuthors].map((r) => r.name) };
    });
    expect(result.book?.title).toBe("New Title");
    expect(result.book?.confidence).toBe("high");
    expect(result.authors).toEqual(["Bob", "Carol"]);
  });
});
