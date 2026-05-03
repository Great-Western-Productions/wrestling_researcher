#!/usr/bin/env tsx
/**
 * Seed an auth user.
 *
 *   pnpm tsx scripts/create-user.ts <email> <password> [name]
 *
 * Idempotent at the schema level (UNIQUE on email): re-running with the same
 * email throws.
 */
import { parseArgs } from "node:util";
import { createUser } from "@/lib/auth/users";
import { db, sql } from "@/lib/db/client";

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [email, password, name] = positionals;
  if (!email || !password) {
    console.error("Usage: pnpm tsx scripts/create-user.ts <email> <password> [name]");
    process.exit(1);
  }

  try {
    const user = await createUser(db, { email, password, name: name ?? null });
    console.log(`Created user ${user.email} (id=${user.id}).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
