import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

const PG_UNIQUE_VIOLATION = "23505";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rowToUser(row: {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}): AuthUser {
  return { id: row.id, email: row.email, name: row.name, image: row.image };
}

export async function createUser(
  db: Db,
  input: { email: string; password: string; name?: string | null },
): Promise<AuthUser> {
  const email = normalizeEmail(input.email);
  const password_hash = await hashPassword(input.password);
  const id = crypto.randomUUID();
  try {
    const rows = await db.execute<{
      id: string;
      email: string;
      name: string | null;
      image: string | null;
    }>(sql`
      INSERT INTO auth_user (id, email, password_hash, name)
      VALUES (${id}, ${email}, ${password_hash}, ${input.name ?? null})
      RETURNING id, email, name, image
    `);
    return rowToUser(rows[0]);
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string }; message?: string };
    const code = e.code ?? e.cause?.code;
    if (code === PG_UNIQUE_VIOLATION || /duplicate key|unique/i.test(e.message ?? "")) {
      throw new Error(`A user with email ${email} already exists.`);
    }
    throw err;
  }
}

export async function findUserByEmail(db: Db, email: string): Promise<AuthUser | null> {
  const rows = await db.execute<{
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  }>(sql`
    SELECT id, email, name, image FROM auth_user
     WHERE email = ${normalizeEmail(email)}
     LIMIT 1
  `);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function verifyUserPassword(
  db: Db,
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const rows = await db.execute<{
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    password_hash: string | null;
  }>(sql`
    SELECT id, email, name, image, password_hash FROM auth_user
     WHERE email = ${normalizeEmail(email)}
     LIMIT 1
  `);
  const row = rows[0];
  if (!row?.password_hash) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return rowToUser(row);
}
