import { afterAll, describe, expect, it } from "vitest";
import {
  authors,
  book_authors,
  books,
  categories,
  periodicals,
  territories,
  wrestler_territory_runs,
  wrestlers,
} from "@/lib/db/schema";
import {
  getDashboardCounts,
  getTopAuthors,
  getBooksByDecade,
  getFeaturedTerritories,
} from "@/lib/queries/dashboard";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("getDashboardCounts", () => {
  it("returns zero counts on an empty DB", async () => {
    const result = await withTx(async (tx) => getDashboardCounts(tx));
    expect(result).toEqual({
      books: 0,
      periodicals: 0,
      authors: 0,
      wrestlerAuthors: 0,
      territories: 0,
      wrestlers: 0,
      byCategory: {},
      byConfidence: {},
    });
  });

  it("aggregates books by category and confidence", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values([
        { code: "about_wrestling", label: "About Wrestling" },
        { code: "fiction", label: "Fiction" },
      ]);
      await tx.insert(books).values([
        { title: "A", category_code: "about_wrestling", confidence: "high" },
        { title: "B", category_code: "about_wrestling", confidence: "medium" },
        { title: "C", category_code: "fiction", confidence: "low" },
      ]);
      return getDashboardCounts(tx);
    });
    expect(result.books).toBe(3);
    expect(result.byCategory).toEqual({ about_wrestling: 2, fiction: 1 });
    expect(result.byConfidence).toEqual({ high: 1, medium: 1, low: 1 });
  });

  it("counts wrestler-authors via is_wrestler flag", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(authors).values([
        { name: "Civilian Author", is_wrestler: 0 },
        { name: "Wrestling Author", is_wrestler: 1 },
        { name: "Another Wrestler", is_wrestler: 1 },
      ]);
      return getDashboardCounts(tx);
    });
    expect(result.authors).toBe(3);
    expect(result.wrestlerAuthors).toBe(2);
  });
});

describe("getTopAuthors", () => {
  it("returns authors ordered by book count desc, then name", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      const [a1] = await tx.insert(authors).values({ name: "Alice" }).returning();
      const [a2] = await tx.insert(authors).values({ name: "Bob" }).returning();
      const [b1] = await tx.insert(books).values({ title: "B1", category_code: "x" }).returning();
      const [b2] = await tx.insert(books).values({ title: "B2", category_code: "x" }).returning();
      await tx.insert(book_authors).values([
        { book_id: b1!.id, author_id: a1!.id, role: "author" },
        { book_id: b2!.id, author_id: a1!.id, role: "author" },
        { book_id: b1!.id, author_id: a2!.id, role: "author" },
      ]);
      return getTopAuthors(tx, 25);
    });
    expect(result.map((r) => r.name)).toEqual(["Alice", "Bob"]);
    expect(result[0]?.bookCount).toBe(2);
    expect(result[1]?.bookCount).toBe(1);
  });
});

describe("getBooksByDecade", () => {
  it("buckets books into decade slots", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      await tx.insert(books).values([
        { title: "1985 book", category_code: "x", year_published: 1985 },
        { title: "1989 book", category_code: "x", year_published: 1989 },
        { title: "1992 book", category_code: "x", year_published: 1992 },
        { title: "Undated", category_code: "x", year_published: null },
      ]);
      return getBooksByDecade(tx);
    });
    expect(result).toEqual([
      { decade: 1980, count: 2 },
      { decade: 1990, count: 1 },
    ]);
  });
});

describe("getFeaturedTerritories", () => {
  it("ranks territories by run count, capped to limit", async () => {
    const result = await withTx(async (tx) => {
      const [t1] = await tx
        .insert(territories)
        .values({ name: "Big T" })
        .returning();
      const [t2] = await tx
        .insert(territories)
        .values({ name: "Small T" })
        .returning();
      const [w] = await tx
        .insert(wrestlers)
        .values({ primary_ring_name: "W" })
        .returning();
      await tx.insert(wrestler_territory_runs).values([
        { wrestler_id: w!.id, territory_id: t1!.id },
        { wrestler_id: w!.id, territory_id: t1!.id },
        { wrestler_id: w!.id, territory_id: t2!.id },
      ]);
      return getFeaturedTerritories(tx, 8);
    });
    expect(result.map((r) => r.name)).toEqual(["Big T", "Small T"]);
    expect(result[0]?.runCount).toBe(2);
  });
});
