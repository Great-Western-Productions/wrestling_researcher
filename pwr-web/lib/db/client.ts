import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

declare global {
  // eslint-disable-next-line no-var
  var __pwr_pg__: ReturnType<typeof postgres> | undefined;
}

const sql = globalThis.__pwr_pg__ ?? postgres(databaseUrl, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pwr_pg__ = sql;
}

export const db = drizzle(sql, { schema });
export { sql };
export type Database = typeof db;
