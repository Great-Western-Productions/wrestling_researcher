import { afterAll, describe, expect, it } from "vitest";
import { authors, book_authors, books, categories, periodicals } from "@/lib/db/schema";
import { booksForAuthor, getAuthorById } from "@/lib/queries/authors";
import { listPeriodicals } from "@/lib/queries/periodicals";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("listPeriodicals", () => {
  it("filters by country, type, and in-archive flag", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(periodicals).values([
        { title: "PWI", country: "US", type: "magazine", archive_in_collection: true },
        {
          title: "Observer",
          country: "US",
          type: "newsletter",
          archive_in_collection: false,
        },
        { title: "Tokyo Sports", country: "JP", type: "newspaper" },
      ]);
      return Promise.all([
        listPeriodicals(tx, { country: "US" }),
        listPeriodicals(tx, { type: "magazine" }),
        listPeriodicals(tx, { inArchive: true }),
      ]);
    });
    expect(result[0].rows.map((r) => r.title).sort()).toEqual(["Observer", "PWI"]);
    expect(result[1].rows.map((r) => r.title)).toEqual(["PWI"]);
    expect(result[2].rows.map((r) => r.title)).toEqual(["PWI"]);
  });

  it("populates countries and types arrays", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(periodicals).values([
        { title: "A", country: "US", type: "magazine" },
        { title: "B", country: "JP", type: "newsletter" },
      ]);
      return listPeriodicals(tx, {});
    });
    expect(result.countries).toEqual(["JP", "US"]);
    expect(result.types).toEqual(["magazine", "newsletter"]);
  });
});

describe("getAuthorById + booksForAuthor", () => {
  it("returns books with role, ordered chronologically", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "x", label: "X" });
      const [a] = await tx.insert(authors).values({ name: "Author One" }).returning();
      const inserted = await tx
        .insert(books)
        .values([
          { title: "Newer", category_code: "x", year_published: 2010 },
          { title: "Older", category_code: "x", year_published: 1990 },
        ])
        .returning();
      await tx.insert(book_authors).values([
        { book_id: inserted[0]!.id, author_id: a!.id, role: "author" },
        { book_id: inserted[1]!.id, author_id: a!.id, role: "co-author" },
      ]);
      return {
        author: await getAuthorById(tx, a!.id),
        books: await booksForAuthor(tx, a!.id),
      };
    });
    expect(result.author?.name).toBe("Author One");
    expect(result.books.map((b) => b.title)).toEqual(["Older", "Newer"]);
    expect(result.books[0]?.role).toBe("co-author");
  });
});
