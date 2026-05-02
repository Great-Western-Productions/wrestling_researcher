import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type BookRow = {
  id: number;
  title: string;
  subtitle: string | null;
  category_code: string;
  publisher: string | null;
  year_published: number | null;
  isbn10: string | null;
  isbn13: string | null;
  pages: number | null;
  format: string | null;
  language: string | null;
  country: string | null;
  subject_wrestler: string | null;
  era: string | null;
  territory_or_promotion: string | null;
  synopsis: string | null;
  source_url: string | null;
  confidence: string | null;
  primary_source_value: string | null;
  created_at: string | null;
};

export type BookListItem = {
  book: BookRow;
  authors: AuthorRef[];
};

export type AuthorRef = {
  id: number;
  name: string;
  is_wrestler: boolean | null;
  role: string;
};

export type BookFilters = {
  cat?: string;
  q?: string;
  country?: string;
  era?: string;
  confidence?: string;
  yearFrom?: number;
  yearTo?: number;
  sort?: "author" | "year_desc" | "year_asc" | "title" | "category";
  page?: number;
  perPage?: number;
};

export type BookListResult = {
  items: BookListItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  countries: string[];
  eras: string[];
};

const SORT_MAP: Record<NonNullable<BookFilters["sort"]>, SQL> = {
  author: sql`primary_author NULLS LAST, LOWER(b.title)`,
  year_desc: sql`b.year_published DESC NULLS LAST, LOWER(b.title)`,
  year_asc: sql`b.year_published ASC NULLS LAST, LOWER(b.title)`,
  title: sql`LOWER(b.title)`,
  category: sql`b.category_code, b.year_published DESC NULLS LAST, LOWER(b.title)`,
};

export async function listBooks(db: Db, filters: BookFilters): Promise<BookListResult> {
  const perPage = filters.perPage ?? 30;
  const page = Math.max(1, filters.page ?? 1);
  const sort = filters.sort ?? "author";

  const conds: SQL[] = [];
  if (filters.cat) conds.push(sql`b.category_code = ${filters.cat}`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(sql`(b.title ILIKE ${like} OR EXISTS(
      SELECT 1 FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
       WHERE ba.book_id = b.id AND a.name ILIKE ${like}))`);
  }
  if (filters.country) conds.push(sql`b.country = ${filters.country}`);
  if (filters.era) conds.push(sql`b.era = ${filters.era}`);
  if (filters.confidence) conds.push(sql`b.confidence = ${filters.confidence}`);
  if (filters.yearFrom !== undefined) conds.push(sql`b.year_published >= ${filters.yearFrom}`);
  if (filters.yearTo !== undefined) conds.push(sql`b.year_published <= ${filters.yearTo}`);

  const whereSql =
    conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const totalRow = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM books b ${whereSql}`,
  );
  const total = totalRow[0]?.n ?? 0;

  const orderBy = SORT_MAP[sort];
  const offset = (page - 1) * perPage;

  const rows = await db.execute<BookRow & { primary_author: string | null }>(sql`
    SELECT b.*,
           (SELECT MIN(LOWER(a.name))
              FROM book_authors ba
              JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id) AS primary_author
      FROM books b ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ${perPage} OFFSET ${offset}
  `);

  const ids = rows.map((r) => r.id);
  const authorsByBook = ids.length > 0 ? await authorsForBooks(db, ids) : new Map();

  const items: BookListItem[] = rows.map((r) => {
    const { primary_author: _ignored, ...book } = r;
    return { book, authors: authorsByBook.get(r.id) ?? [] };
  });

  const [countries, eras] = await Promise.all([
    distinctValues(db, "books", "country"),
    distinctValues(db, "books", "era"),
  ]);

  return {
    items,
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    countries,
    eras,
  };
}

export async function getBookById(db: Db, id: number): Promise<BookRow | null> {
  const rows = await db.execute<BookRow>(
    sql`SELECT * FROM books WHERE id = ${id}`,
  );
  return rows[0] ?? null;
}

export async function authorsForBook(db: Db, bookId: number): Promise<AuthorRef[]> {
  const rows = await db.execute<AuthorRef>(sql`
    SELECT a.id, a.name, a.is_wrestler, ba.role
      FROM book_authors ba
      JOIN authors a ON a.id = ba.author_id
     WHERE ba.book_id = ${bookId}
     ORDER BY ba.role, a.name
  `);
  return [...rows];
}

async function authorsForBooks(db: Db, bookIds: number[]): Promise<Map<number, AuthorRef[]>> {
  const rows = await db.execute<AuthorRef & { book_id: number }>(sql`
    SELECT ba.book_id, a.id, a.name, a.is_wrestler, ba.role
      FROM book_authors ba
      JOIN authors a ON a.id = ba.author_id
     WHERE ba.book_id IN ${sql`(${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`}
     ORDER BY ba.role, a.name
  `);
  const map = new Map<number, AuthorRef[]>();
  for (const r of rows) {
    const { book_id, ...rest } = r;
    const list = map.get(book_id) ?? [];
    list.push(rest);
    map.set(book_id, list);
  }
  return map;
}

export async function getBookFormOptions(db: Db): Promise<{
  countries: string[];
  eras: string[];
}> {
  const [countries, eras] = await Promise.all([
    distinctValues(db, "books", "country"),
    distinctValues(db, "books", "era"),
  ]);
  return { countries, eras };
}

async function distinctValues(db: Db, table: string, column: string): Promise<string[]> {
  const rows = await db.execute<{ v: string }>(
    sql`SELECT DISTINCT ${sql.identifier(column)} AS v FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} IS NOT NULL ORDER BY ${sql.identifier(column)}`,
  );
  return rows.map((r) => r.v);
}
