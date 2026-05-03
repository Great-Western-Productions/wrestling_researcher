import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { fuzzy, normalizeName } from "@/mcp/api/dedup";

type Db = PostgresJsDatabase<typeof schema>;

export type RepointReport = { table: string; rows: number };

export type MergeWrestlersResult = {
  survivorId: number;
  duplicateId: number;
  fieldsFilled: number;
  repointed: RepointReport[];
  duplicateDeleted: boolean;
};

type FillableSpec = { col: string; type: "text" | "int" | "bool" };
const FILLABLE_WRESTLER_COLS: FillableSpec[] = [
  { col: "legal_name", type: "text" },
  { col: "other_ring_names", type: "text" },
  { col: "born_date", type: "text" },
  { col: "died_date", type: "text" },
  { col: "living", type: "bool" },
  { col: "debut_year", type: "int" },
  { col: "retired_year", type: "int" },
  { col: "primary_role", type: "text" },
  { col: "hometown_billed", type: "text" },
  { col: "hometown_real", type: "text" },
  { col: "finisher", type: "text" },
  { col: "style", type: "text" },
  { col: "socials", type: "text" },
  { col: "convention_status", type: "text" },
  { col: "last_known_appearance", type: "text" },
  { col: "footage_notes", type: "text" },
  { col: "midcard_files_priority", type: "int" },
  { col: "why_they_mattered", type: "text" },
  { col: "notes", type: "text" },
  { col: "height_inches", type: "int" },
  { col: "weight_lbs", type: "int" },
  { col: "bio", type: "text" },
  { col: "cagematch_id", type: "text" },
];

function isBlank(v: unknown, t: FillableSpec["type"]): boolean {
  if (v === null || v === undefined) return true;
  if (t === "text" && v === "") return true;
  return false;
}

export async function mergeWrestlers(
  db: Db,
  survivorId: number,
  duplicateId: number,
): Promise<MergeWrestlersResult> {
  if (survivorId === duplicateId) {
    throw new Error("Cannot merge a wrestler into the same wrestler.");
  }
  return db.transaction(async (tx) => {
    const sRows = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM wrestlers WHERE id = ${survivorId}`,
    );
    const dRows = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM wrestlers WHERE id = ${duplicateId}`,
    );
    if (!sRows[0]) throw new Error(`Survivor wrestler ${survivorId} not found.`);
    if (!dRows[0]) throw new Error(`Duplicate wrestler ${duplicateId} not found.`);
    const survivor = sRows[0];
    const duplicate = dRows[0];

    let fieldsFilled = 0;
    for (const { col, type } of FILLABLE_WRESTLER_COLS) {
      if (!isBlank(survivor[col], type)) continue;
      if (isBlank(duplicate[col], type)) continue;
      const colSql = sql.raw(`"${col}"`);
      await tx.execute(sql`
        UPDATE wrestlers
           SET ${colSql} = ${duplicate[col] as string | number | boolean},
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${survivorId}
      `);
      fieldsFilled++;
    }

    const repointed: RepointReport[] = [];

    // Tables with no unique constraint involving wrestler_id: simple UPDATE.
    const simpleTargets: Array<{ table: string; col: string }> = [
      { table: "ranking_entries", col: "wrestler_id" },
      { table: "reigns", col: "wrestler_id" },
      { table: "wrestler_territory_runs", col: "wrestler_id" },
      { table: "issue_cover_subjects", col: "wrestler_id" },
      { table: "pending_wrestlers", col: "resolved_wrestler_id" },
    ];
    for (const t of simpleTargets) {
      const tableSql = sql.raw(`"${t.table}"`);
      const colSql = sql.raw(`"${t.col}"`);
      const result = await tx.execute<{ id: number }>(sql`
        UPDATE ${tableSql} SET ${colSql} = ${survivorId}
         WHERE ${colSql} = ${duplicateId}
        RETURNING 1 AS id
      `);
      repointed.push({ table: t.table, rows: result.length });
    }

    // Tables with a UNIQUE involving wrestler_id: drop duplicate's row when survivor
    // already has the same key, then UPDATE the rest.
    const conflictKeys: Array<{ table: string; cols: string[] }> = [
      { table: "reign_participants", cols: ["reign_id"] },
      { table: "wrestler_book_citations", cols: ["book_id", "page"] },
      { table: "faction_members", cols: ["faction_id", "joined_year"] },
    ];
    for (const ck of conflictKeys) {
      const tableSql = sql.raw(`"${ck.table}"`);
      const matchClauses = ck.cols
        .map((c) => `t2.${c} IS NOT DISTINCT FROM ${ck.table}.${c}`)
        .join(" AND ");
      await tx.execute(
        sql.raw(`
        DELETE FROM ${ck.table}
         WHERE wrestler_id = ${duplicateId}
           AND EXISTS (
             SELECT 1 FROM ${ck.table} t2
              WHERE t2.wrestler_id = ${survivorId}
                AND ${matchClauses}
           )
      `),
      );
      const result = await tx.execute<{ id: number }>(sql`
        UPDATE ${tableSql} SET wrestler_id = ${survivorId}
         WHERE wrestler_id = ${duplicateId}
        RETURNING 1 AS id
      `);
      repointed.push({ table: ck.table, rows: result.length });
    }

    await tx.execute(sql`DELETE FROM wrestlers WHERE id = ${duplicateId}`);

    return {
      survivorId,
      duplicateId,
      fieldsFilled,
      repointed,
      duplicateDeleted: true,
    };
  });
}

export type DuplicateCandidate = {
  id: number;
  primary_ring_name: string;
  score: number;
};

/**
 * Block by normalized first letter, then score with `fuzzy` and return matches above the threshold.
 * Threshold defaults to 92, mirroring the Python ingest's WRatio cutoff.
 */
export async function findDuplicateCandidates(
  db: Db,
  wrestlerId: number,
  options: { threshold?: number; limit?: number } = {},
): Promise<DuplicateCandidate[]> {
  const threshold = options.threshold ?? 92;
  const limit = options.limit ?? 20;

  const target = await db.execute<{ id: number; primary_ring_name: string }>(
    sql`SELECT id, primary_ring_name FROM wrestlers WHERE id = ${wrestlerId}`,
  );
  if (!target[0]) return [];

  const norm = normalizeName(target[0].primary_ring_name);
  const firstLetter = norm.slice(0, 1);

  const rows = await db.execute<{ id: number; primary_ring_name: string }>(sql`
    SELECT id, primary_ring_name FROM wrestlers
     WHERE id <> ${wrestlerId}
       AND LOWER(LEFT(primary_ring_name, 1)) = ${firstLetter}
  `);

  const scored = rows
    .map((r) => ({
      id: r.id,
      primary_ring_name: r.primary_ring_name,
      score: fuzzy(target[0]!.primary_ring_name, r.primary_ring_name),
    }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}
