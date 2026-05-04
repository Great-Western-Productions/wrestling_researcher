import { afterAll, describe, expect, it } from "vitest";
import { authors, book_authors, books, categories } from "@/lib/db/schema";
import { authorsForBook, getBookById, listBooks } from "@/lib/queries/books";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

async function seedBooks(tx: Parameters<Parameters<typeof withTx>[0]>[0]) {
  await tx.insert(categories).values([
    { code: "about_wrestling", label: "About Wrestling" },
    { code: "fiction", label: "Fiction" },
  ]);
  const [aliceA] = await tx.insert(authors).values({ name: "Alice" }).returning();
  const [bobA] = await tx.insert(authors).values({ name: "Bob" }).returning();
  const inserted = await tx
    .insert(books)
    .values([
      {
        title: "Apple Book",
        category_code: "about_wrestling",
        country: "US",
        era: "Territory",
        confidence: "high",
        year_published: 1980,
      },
      {
        title: "Banana Book",
        category_code: "about_wrestling",
        country: "JP",
        era: "Modern",
        confidence: "low",
        year_published: 2005,
      },
      {
        title: "Cherry Book",
        category_code: "fiction",
        country: "US",
        confidence: "medium",
        year_published: 1992,
      },
    ])
    .returning();
  await tx.insert(book_authors).values([
    { book_id: inserted[0]!.id, author_id: aliceA!.id, role: "author" },
    { book_id: inserted[1]!.id, author_id: bobA!.id, role: "author" },
  ]);
  return { books: inserted, aliceA, bobA };
}

describe("listBooks", () => {
  it("returns all books with pagination metadata", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, {});
    });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.page).toBe(1);
    expect(result.pages).toBe(1);
  });

  it("filters by category", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, { cat: "fiction" });
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.book.title).toBe("Cherry Book");
  });

  it("filters by year range", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, { yearFrom: 1990, yearTo: 1999 });
    });
    expect(result.items.map((i) => i.book.title)).toEqual(["Cherry Book"]);
  });

  it("searches by title or author name (q)", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, { q: "alice" });
    });
    expect(result.items.map((i) => i.book.title)).toEqual(["Apple Book"]);
  });

  it("sorts by year_desc", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, { sort: "year_desc" });
    });
    expect(result.items.map((i) => i.book.title)).toEqual([
      "Banana Book",
      "Cherry Book",
      "Apple Book",
    ]);
  });

  it("hydrates authors per book", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, { sort: "title" });
    });
    const apple = result.items.find((i) => i.book.title === "Apple Book")!;
    expect(apple.authors.map((a) => a.name)).toEqual(["Alice"]);
    const cherry = result.items.find((i) => i.book.title === "Cherry Book")!;
    expect(cherry.authors).toEqual([]);
  });

  it("returns distinct countries and eras for filter dropdowns", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, {});
    });
    expect(result.countries).toEqual(["JP", "US"]);
    expect(result.eras).toEqual(["Modern", "Territory"]);
  });

  it("paginates with perPage", async () => {
    const result = await withTx(async (tx) => {
      await seedBooks(tx);
      return listBooks(tx, { perPage: 2, page: 2, sort: "title" });
    });
    expect(result.items).toHaveLength(1);
    expect(result.pages).toBe(2);
  });
});

describe("getBookById", () => {
  it("returns the book or null", async () => {
    const { found, missing } = await withTx(async (tx) => {
      const { books: inserted } = await seedBooks(tx);
      return {
        found: await getBookById(tx, inserted[0]!.id),
        missing: await getBookById(tx, 9_999),
      };
    });
    expect(found?.title).toBe("Apple Book");
    expect(missing).toBeNull();
  });
});

describe("authorsForBook", () => {
  it("returns authors with role, ordered by role then name", async () => {
    const result = await withTx(async (tx) => {
      const { books: inserted } = await seedBooks(tx);
      return authorsForBook(tx, inserted[0]!.id);
    });
    expect(result).toEqual([expect.objectContaining({ name: "Alice", role: "author" })]);
  });
});
