/**
 * MCP API surface — the single namespace `pwr` that user-written Code Mode scripts
 * can call. Each entry is `(db, ...args) => Promise<unknown>`. The sandbox host
 * looks up methods by `namespace.method` and injects the db handle (which may be
 * a transaction when the caller passed `dryRun: true`).
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { findBookByTitleYear, insertBook, mergeBooks } from "@/lib/db-ops/books";
import {
  listPendingWrestlers,
  promotePending,
  resolvePendingTo,
} from "@/lib/db-ops/pending-wrestlers";
import { insertTerritory, upsertTerritoryByCagematch } from "@/lib/db-ops/territories";
import {
  findDuplicateCandidates,
  findWrestlerByRingName,
  insertWrestler,
  mergeWrestlers,
  patchWrestlerFillBlanks,
} from "@/lib/db-ops/wrestlers";
import { fuzzy, normalizeName } from "@/lib/dedup";

type Db = PostgresJsDatabase<typeof schema>;
// biome-ignore lint/suspicious/noExplicitAny: the registry below holds methods with unrelated parameter lists; `unknown[]` is checked contravariantly and rejects every one of them
type Method = (db: Db, ...args: any[]) => Promise<unknown>;

async function recentAudit(db: Db, limit = 20): Promise<unknown> {
  return db.execute(sql`
    SELECT id, created_at, code_excerpt, dry_run, duration_ms, result_status
      FROM mcp_audit_log
     ORDER BY id DESC
     LIMIT ${limit}
  `);
}

async function recent(db: Db, table: string, limit = 20): Promise<unknown> {
  const allowed = new Set([
    "wrestlers",
    "books",
    "territories",
    "pending_wrestlers",
    "ranking_entries",
    "wrestler_territory_runs",
    "reigns",
    "titles",
  ]);
  if (!allowed.has(table)) throw new Error(`Table not on the audit-recent allowlist: ${table}`);
  const tableSql = sql.raw(`"${table}"`);
  return db.execute(sql`SELECT * FROM ${tableSql} ORDER BY id DESC LIMIT ${limit}`);
}

export const REGISTRY: Record<string, Method> = {
  "wrestlers.findByRingName": (db, name: string) => findWrestlerByRingName(db, name),
  "wrestlers.add": (db, input) => insertWrestler(db, input),
  "wrestlers.patchFillBlanks": (db, id: number, patch) => patchWrestlerFillBlanks(db, id, patch),
  "wrestlers.mergeInto": (db, survivorId: number, duplicateId: number) =>
    mergeWrestlers(db, survivorId, duplicateId),
  "wrestlers.findDuplicateCandidates": (db, id: number, opts) =>
    findDuplicateCandidates(db, id, opts ?? {}),

  "books.add": (db, input) => insertBook(db, input),
  "books.findByTitleYear": (db, title: string, year: number | null) =>
    findBookByTitleYear(db, title, year ?? null),
  "books.merge": (db, targetId: number, dupId: number) => mergeBooks(db, targetId, dupId),

  "territories.add": (db, input) => insertTerritory(db, input),
  "territories.upsertByCagematch": (db, input) => upsertTerritoryByCagematch(db, input),

  "pendingWrestlers.list": (db, opts) => listPendingWrestlers(db, opts ?? {}),
  "pendingWrestlers.resolveTo": (db, pendingId: number, wrestlerId: number) =>
    resolvePendingTo(db, pendingId, wrestlerId),
  "pendingWrestlers.promote": (db, pendingId: number) => promotePending(db, pendingId),

  "dedup.normalizeName": async (_db, s: string) => normalizeName(s),
  "dedup.fuzzy": async (_db, a: string, b: string) => fuzzy(a, b),

  "audit.recent": (db, opts: { table?: string; limit?: number } = {}) =>
    opts.table ? recent(db, opts.table, opts.limit) : recentAudit(db, opts.limit),
};

export const NAMESPACES = Array.from(new Set(Object.keys(REGISTRY).map((m) => m.split(".")[0])));
