import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  authors,
  book_authors,
  books,
  categories,
  pending_wrestlers,
  periodical_issues,
  periodicals,
  ranking_entries,
  ranking_lists,
  wrestlers,
} from "@/lib/db/schema";
import {
  mergeBooks,
  mergePendingIntoWrestler,
  unmergePendingFromWrestler,
} from "@/lib/db-ops/merge";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("mergeBooks", () => {
  it("fills target's blank fields from duplicate, merges authors, deletes duplicate", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      const [target] = await tx
        .insert(books)
        .values({
          title: "Same Title",
          category_code: "x",
          publisher: "Target Pub",
          year_published: null,
          isbn13: null,
        })
        .returning();
      const [dup] = await tx
        .insert(books)
        .values({
          title: "Same Title",
          category_code: "x",
          publisher: "Dup Pub",
          year_published: 1990,
          isbn13: "978-1234567890",
        })
        .returning();
      const [a1] = await tx.insert(authors).values({ name: "Alice" }).returning();
      const [a2] = await tx.insert(authors).values({ name: "Bob" }).returning();
      await tx.insert(book_authors).values([
        { book_id: target!.id, author_id: a1!.id, role: "author" },
        { book_id: dup!.id, author_id: a1!.id, role: "author" },
        { book_id: dup!.id, author_id: a2!.id, role: "author" },
      ]);

      await mergeBooks(tx, target!.id, dup!.id);

      const merged = await tx.execute<{
        id: number;
        publisher: string | null;
        year_published: number | null;
        isbn13: string | null;
      }>(sql`SELECT id, publisher, year_published, isbn13 FROM books WHERE id = ${target!.id}`);
      const survivedDup = await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM books WHERE id = ${dup!.id}`,
      );
      const linked = await tx.execute<{ name: string }>(sql`
        SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ${target!.id} ORDER BY a.name
      `);
      return {
        merged: merged[0],
        dupExists: (survivedDup[0]?.count ?? 0) > 0,
        authors: [...linked].map((r) => r.name),
      };
    });

    // Target keeps its publisher; duplicate's year + isbn fill the blanks.
    expect(result.merged?.publisher).toBe("Target Pub");
    expect(result.merged?.year_published).toBe(1990);
    expect(result.merged?.isbn13).toBe("978-1234567890");
    expect(result.dupExists).toBe(false);
    expect(result.authors).toEqual(["Alice", "Bob"]);
  });

  it("rejects merging a book into itself", async () => {
    await expect(
      withTx(async (tx) => {
        await tx.insert(categories).values({ code: "x", label: "X" });
        const [b] = await tx.insert(books).values({ title: "T", category_code: "x" }).returning();
        return mergeBooks(tx, b!.id, b!.id);
      }),
    ).rejects.toThrow();
  });
});

describe("mergePendingIntoWrestler", () => {
  it("links pending row + backfills ranking_entries", async () => {
    const result = await withTx(async (tx) => {
      const [periodical] = await tx.insert(periodicals).values({ title: "PWI" }).returning();
      const [issue] = await tx
        .insert(periodical_issues)
        .values({ periodical_id: periodical!.id, publication_date: "1985-07-01" })
        .returning();
      const [list] = await tx
        .insert(ranking_lists)
        .values({ issue_id: issue!.id, list_label: "Top 10", list_scope: "global" })
        .returning();
      const [pending] = await tx
        .insert(pending_wrestlers)
        .values({ printed_name: "Foo", normalized_name: "foo", occurrence_count: 1 })
        .returning();
      const [target] = await tx
        .insert(wrestlers)
        .values({ primary_ring_name: "Foo The Wrestler" })
        .returning();
      await tx.insert(ranking_entries).values({
        ranking_list_id: list!.id,
        rank: 1,
        entry_name: "Foo",
        pending_wrestler_id: pending!.id,
      });

      const out = await mergePendingIntoWrestler(tx, pending!.id, target!.id);
      const reloaded = await tx.execute<{ resolved_wrestler_id: number | null }>(
        sql`SELECT resolved_wrestler_id FROM pending_wrestlers WHERE id = ${pending!.id}`,
      );
      const entries = await tx.execute<{
        wrestler_id: number | null;
        pending_wrestler_id: number | null;
      }>(
        sql`SELECT wrestler_id, pending_wrestler_id FROM ranking_entries WHERE ranking_list_id = ${list!.id}`,
      );
      return {
        out,
        resolved: reloaded[0]?.resolved_wrestler_id,
        targetId: target!.id,
        entries: [...entries],
      };
    });
    expect(result.out.rankingEntriesBackfilled).toBe(1);
    expect(result.out.wrestlerName).toBe("Foo The Wrestler");
    expect(result.resolved).toBe(result.targetId);
    expect(result.entries[0]?.wrestler_id).toBe(result.targetId);
    expect(result.entries[0]?.pending_wrestler_id).toBeNull();
  });
});

describe("unmergePendingFromWrestler", () => {
  it("clears resolved_wrestler_id and reverts matching ranking_entries", async () => {
    const result = await withTx(async (tx) => {
      const [periodical] = await tx.insert(periodicals).values({ title: "PWI" }).returning();
      const [issue] = await tx
        .insert(periodical_issues)
        .values({ periodical_id: periodical!.id, publication_date: "1985-07-01" })
        .returning();
      const [list] = await tx
        .insert(ranking_lists)
        .values({ issue_id: issue!.id, list_label: "Top 10", list_scope: "global" })
        .returning();
      const [target] = await tx.insert(wrestlers).values({ primary_ring_name: "Foo" }).returning();
      const [pending] = await tx
        .insert(pending_wrestlers)
        .values({
          printed_name: "Foo",
          normalized_name: "foo",
          occurrence_count: 1,
          resolved_wrestler_id: target!.id,
        })
        .returning();
      // Entries that the previous merge had set
      await tx.insert(ranking_entries).values({
        ranking_list_id: list!.id,
        rank: 1,
        entry_name: "Foo",
        wrestler_id: target!.id,
        pending_wrestler_id: null,
      });

      const out = await unmergePendingFromWrestler(tx, pending!.id);
      const reloaded = await tx.execute<{ resolved_wrestler_id: number | null }>(
        sql`SELECT resolved_wrestler_id FROM pending_wrestlers WHERE id = ${pending!.id}`,
      );
      const entries = await tx.execute<{
        wrestler_id: number | null;
        pending_wrestler_id: number | null;
      }>(
        sql`SELECT wrestler_id, pending_wrestler_id FROM ranking_entries WHERE ranking_list_id = ${list!.id}`,
      );
      return {
        out,
        resolved: reloaded[0]?.resolved_wrestler_id,
        entries: [...entries],
        pid: pending!.id,
      };
    });
    expect(result.out.rankingEntriesReverted).toBe(1);
    expect(result.resolved).toBeNull();
    expect(result.entries[0]?.wrestler_id).toBeNull();
    expect(result.entries[0]?.pending_wrestler_id).toBe(result.pid);
  });

  it("throws when there's nothing to undo", async () => {
    await expect(
      withTx(async (tx) => {
        const [pending] = await tx
          .insert(pending_wrestlers)
          .values({ printed_name: "X", normalized_name: "x", occurrence_count: 1 })
          .returning();
        return unmergePendingFromWrestler(tx, pending!.id);
      }),
    ).rejects.toThrow();
  });
});
