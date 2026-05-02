import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/wrestling_bibliography";

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  introspect: { casing: "preserve" },
  verbose: true,
  strict: true,
});
