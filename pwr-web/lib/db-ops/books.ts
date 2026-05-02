import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getCheckbox, getInt, getStr } from "@/lib/actions/_helpers";

type Db = PostgresJsDatabase<typeof schema>;

export type BookInput = {
  title: string;
  subtitle: string | null;
  category_code: string;
  publisher: string | null;
  year_published: number | null;
  isbn10: string | null;
  isbn13: string | null;
  pages: number | null;
  format: string | null;
  language: string;
  country: string | null;
  subject_wrestler: string | null;
  era: string | null;
  territory_or_promotion: string | null;
  synopsis: string | null;
  source_url: string | null;
  confidence: string;
  authorNames: string[];
  authorsAreWrestlers: boolean;
};

export class ValidationError extends Error {}

export function parseBookInput(form: FormData): BookInput {
  const title = getStr(form, "title");
  const category_code = getStr(form, "category_code");
  if (!title || !category_code) {
    throw new ValidationError("Title and category are required.");
  }
  const authorsField = (form.get("authors") as string | null) ?? "";
  const authorNames = authorsField
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    title,
    category_code,
    subtitle: getStr(form, "subtitle"),
    publisher: getStr(form, "publisher"),
    year_published: getInt(form, "year_published"),
    isbn10: getStr(form, "isbn10"),
    isbn13: getStr(form, "isbn13"),
    pages: getInt(form, "pages"),
    format: getStr(form, "format"),
    language: getStr(form, "language") ?? "English",
    country: getStr(form, "country"),
    subject_wrestler: getStr(form, "subject_wrestler"),
    era: getStr(form, "era"),
    territory_or_promotion: getStr(form, "territory_or_promotion"),
    synopsis: getStr(form, "synopsis"),
    source_url: getStr(form, "source_url"),
    confidence: getStr(form, "confidence") ?? "medium",
    authorNames,
    authorsAreWrestlers: getCheckbox(form, "authors_are_wrestlers"),
  };
}

async function syncBookAuthors(
  tx: Db,
  bookId: number,
  authorNames: string[],
  authorsAreWrestlers: boolean,
): Promise<void> {
  await tx.execute(sql`DELETE FROM book_authors WHERE book_id = ${bookId}`);
  for (const name of authorNames) {
    const existing = await tx.execute<{ id: number }>(
      sql`SELECT id FROM authors WHERE name = ${name}`,
    );
    let aid = existing[0]?.id;
    if (!aid) {
      const created = await tx.execute<{ id: number }>(
        sql`INSERT INTO authors (name, is_wrestler) VALUES (${name}, ${authorsAreWrestlers}) RETURNING id`,
      );
      aid = created[0]!.id;
    }
    await tx.execute(sql`
      INSERT INTO book_authors (book_id, author_id, role)
      VALUES (${bookId}, ${aid}, 'author')
      ON CONFLICT DO NOTHING
    `);
  }
}

/** Insert a new book with its authors. Returns the new book id. */
export async function insertBook(db: Db, input: BookInput): Promise<number> {
  return db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: number }>(sql`
      INSERT INTO books (title, subtitle, category_code, publisher, year_published,
                         isbn10, isbn13, pages, format, language, country,
                         subject_wrestler, era, territory_or_promotion, synopsis,
                         source_url, confidence)
      VALUES (${input.title}, ${input.subtitle}, ${input.category_code},
              ${input.publisher}, ${input.year_published}, ${input.isbn10},
              ${input.isbn13}, ${input.pages}, ${input.format}, ${input.language},
              ${input.country}, ${input.subject_wrestler}, ${input.era},
              ${input.territory_or_promotion}, ${input.synopsis}, ${input.source_url},
              ${input.confidence})
      RETURNING id
    `);
    const bookId = inserted[0]!.id;
    await syncBookAuthors(tx, bookId, input.authorNames, input.authorsAreWrestlers);
    return bookId;
  });
}

/** Update an existing book and re-sync its authors. */
export async function updateBook(db: Db, bookId: number, input: BookInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE books
         SET title = ${input.title}, subtitle = ${input.subtitle},
             category_code = ${input.category_code}, publisher = ${input.publisher},
             year_published = ${input.year_published}, isbn10 = ${input.isbn10},
             isbn13 = ${input.isbn13}, pages = ${input.pages}, format = ${input.format},
             language = ${input.language}, country = ${input.country},
             subject_wrestler = ${input.subject_wrestler}, era = ${input.era},
             territory_or_promotion = ${input.territory_or_promotion},
             synopsis = ${input.synopsis}, source_url = ${input.source_url},
             confidence = ${input.confidence}
       WHERE id = ${bookId}
    `);
    await syncBookAuthors(tx, bookId, input.authorNames, input.authorsAreWrestlers);
  });
}
