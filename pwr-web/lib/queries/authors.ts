import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import type { BookRow } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type AuthorRow = {
  id: number;
  name: string;
  ring_name: string | null;
  is_wrestler: number | null;
  notes: string | null;
};

export async function getAuthorById(db: Db, id: number): Promise<AuthorRow | null> {
  const rows = await db.execute<AuthorRow>(
    sql`SELECT * FROM authors WHERE id = ${id}`,
  );
  return rows[0] ?? null;
}

export type AuthorBookRow = BookRow & { role: string };

export async function booksForAuthor(db: Db, authorId: number): Promise<AuthorBookRow[]> {
  const rows = await db.execute<AuthorBookRow>(sql`
    SELECT b.*, ba.role
      FROM books b
      JOIN book_authors ba ON ba.book_id = b.id
     WHERE ba.author_id = ${authorId}
     ORDER BY b.year_published ASC NULLS LAST, LOWER(b.title)
  `);
  return [...rows];
}
