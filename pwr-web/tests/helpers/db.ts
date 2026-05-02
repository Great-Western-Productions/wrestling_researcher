import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

let cachedSql: ReturnType<typeof postgres> | undefined;
let cachedDb: PostgresJsDatabase<typeof schema> | undefined;

function getDb() {
  if (!cachedDb) {
    const url = process.env.PWR_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("Test DATABASE_URL not set (global-setup did not run?)");
    cachedSql = postgres(url, { max: 5 });
    cachedDb = drizzle(cachedSql, { schema });
  }
  return cachedDb;
}

/**
 * Run `fn` inside a Drizzle transaction that always rolls back at the end.
 * Use this in integration tests so each test sees an empty (post-migration) DB.
 *
 * Drizzle's `transaction()` rolls back if the callback throws, so we throw a
 * sentinel to force rollback and swallow it.
 */
class _Rollback extends Error {}
const ROLLBACK = new _Rollback("rollback");

export async function withTx<T>(
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  const db = getDb();
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return result as T;
}

export async function closeTestDb() {
  if (cachedSql) {
    await cachedSql.end();
    cachedSql = undefined;
    cachedDb = undefined;
  }
}
