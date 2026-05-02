import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import fs from "node:fs";

let container: StartedPostgreSqlContainer | undefined;

export async function setup() {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("wrestling_bibliography_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  // Vitest serializes globalSetup return values into env for workers.
  process.env.PWR_TEST_DATABASE_URL = url;

  const migrationsFolder = path.resolve(__dirname, "..", "..", "lib", "db", "migrations");
  if (fs.existsSync(migrationsFolder) && fs.readdirSync(migrationsFolder).length > 0) {
    const sql = postgres(url, { max: 1 });
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder });
    await sql.end();
  }
}

export async function teardown() {
  await container?.stop();
}
