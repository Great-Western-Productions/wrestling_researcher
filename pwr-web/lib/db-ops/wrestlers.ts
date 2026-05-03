import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getInt, getStr } from "@/lib/actions/_helpers";
import type * as schema from "@/lib/db/schema";
import { ValidationError } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type WrestlerInput = {
  legal_name: string | null;
  primary_ring_name: string;
  other_ring_names: string | null;
  born_date: string | null;
  died_date: string | null;
  living: boolean | null;
  debut_year: number | null;
  retired_year: number | null;
  primary_role: string | null;
  hometown_billed: string | null;
  hometown_real: string | null;
  finisher: string | null;
  style: string | null;
  socials: string | null;
  convention_status: string | null;
  last_known_appearance: string | null;
  footage_notes: string | null;
  midcard_files_status: string;
  midcard_files_priority: number | null;
  why_they_mattered: string | null;
  notes: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  bio: string | null;
  fromPending: number | null;
};

export function parseWrestlerInput(form: FormData): WrestlerInput {
  const primary_ring_name = getStr(form, "primary_ring_name");
  if (!primary_ring_name) throw new ValidationError("Primary ring name is required.");
  const livingRaw = getStr(form, "living");
  const living = livingRaw === "1" ? true : livingRaw === "0" ? false : null;
  return {
    primary_ring_name,
    legal_name: getStr(form, "legal_name"),
    other_ring_names: getStr(form, "other_ring_names"),
    born_date: getStr(form, "born_date"),
    died_date: getStr(form, "died_date"),
    living,
    debut_year: getInt(form, "debut_year"),
    retired_year: getInt(form, "retired_year"),
    primary_role: getStr(form, "primary_role"),
    hometown_billed: getStr(form, "hometown_billed"),
    hometown_real: getStr(form, "hometown_real"),
    finisher: getStr(form, "finisher"),
    style: getStr(form, "style"),
    socials: getStr(form, "socials"),
    convention_status: getStr(form, "convention_status"),
    last_known_appearance: getStr(form, "last_known_appearance"),
    footage_notes: getStr(form, "footage_notes"),
    midcard_files_status: getStr(form, "midcard_files_status") ?? "queued",
    midcard_files_priority: getInt(form, "midcard_files_priority"),
    why_they_mattered: getStr(form, "why_they_mattered"),
    notes: getStr(form, "notes"),
    height_inches: getInt(form, "height_inches"),
    weight_lbs: getInt(form, "weight_lbs"),
    bio: getStr(form, "bio"),
    fromPending: getInt(form, "from_pending"),
  };
}

export type InsertWrestlerResult = {
  id: number;
  /** When promoting from a pending row: how many ranking_entries got backfilled. */
  rankingEntriesBackfilled: number;
};

export async function insertWrestler(db: Db, input: WrestlerInput): Promise<InsertWrestlerResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: number }>(sql`
      INSERT INTO wrestlers (legal_name, primary_ring_name, other_ring_names, born_date,
                             died_date, living, debut_year, retired_year, primary_role,
                             hometown_billed, hometown_real, finisher, style, socials,
                             convention_status, last_known_appearance, footage_notes,
                             midcard_files_status, midcard_files_priority,
                             why_they_mattered, notes,
                             height_inches, weight_lbs, bio)
      VALUES (${input.legal_name}, ${input.primary_ring_name}, ${input.other_ring_names},
              ${input.born_date}, ${input.died_date}, ${input.living}, ${input.debut_year},
              ${input.retired_year}, ${input.primary_role}, ${input.hometown_billed},
              ${input.hometown_real}, ${input.finisher}, ${input.style}, ${input.socials},
              ${input.convention_status}, ${input.last_known_appearance},
              ${input.footage_notes}, ${input.midcard_files_status},
              ${input.midcard_files_priority}, ${input.why_they_mattered}, ${input.notes},
              ${input.height_inches}, ${input.weight_lbs}, ${input.bio})
      RETURNING id
    `);
    const id = inserted[0]!.id;

    let rankingEntriesBackfilled = 0;
    if (input.fromPending) {
      await tx.execute(
        sql`UPDATE pending_wrestlers SET resolved_wrestler_id = ${id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${input.fromPending}`,
      );
      const updated = await tx.execute<{ count: number }>(sql`
        WITH updated AS (
          UPDATE ranking_entries
             SET wrestler_id = ${id}, pending_wrestler_id = NULL
           WHERE pending_wrestler_id = ${input.fromPending}
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM updated
      `);
      rankingEntriesBackfilled = updated[0]?.count ?? 0;
    }

    return { id, rankingEntriesBackfilled };
  });
}

export async function findWrestlerByRingName(
  db: Db,
  ringName: string,
): Promise<{ id: number; primary_ring_name: string } | null> {
  const rows = await db.execute<{ id: number; primary_ring_name: string }>(
    sql`SELECT id, primary_ring_name FROM wrestlers WHERE LOWER(primary_ring_name) = LOWER(${ringName}) LIMIT 1`,
  );
  return rows[0] ?? null;
}

/**
 * Update only the columns currently NULL/empty on the row — so curator edits
 * are never overwritten by re-ingesting the same source. Returns the count of
 * columns that actually changed.
 */
export async function patchWrestlerFillBlanks(
  db: Db,
  id: number,
  patch: Partial<Omit<WrestlerInput, "fromPending" | "midcard_files_status">>,
): Promise<number> {
  type ColType = "text" | "int" | "bool";
  const fillable: Array<{ col: string; type: ColType }> = [
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
  ];

  let changed = 0;
  for (const { col, type } of fillable) {
    const val = (patch as Record<string, unknown>)[col];
    if (val === undefined || val === null || val === "") continue;

    const colSql = sql.raw(`"${col}"`);
    const blankCheck = type === "text" ? sql`OR ${colSql} = ''` : sql``;
    const result = await db.execute<{ id: number }>(sql`
      UPDATE wrestlers
         SET ${colSql} = ${val as string | number | boolean},
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ${id}
         AND (${colSql} IS NULL ${blankCheck})
      RETURNING id
    `);
    if (result.length > 0) changed++;
  }
  return changed;
}

export async function addCitation(
  db: Db,
  wrestlerId: number,
  bookId: number,
  page: string | null,
  excerpt: string | null,
): Promise<{ id: number; created: boolean }> {
  const rows = await db.execute<{ id: number; created: boolean }>(sql`
    INSERT INTO wrestler_book_citations (wrestler_id, book_id, page, excerpt)
    VALUES (${wrestlerId}, ${bookId}, ${page}, ${excerpt})
    ON CONFLICT (wrestler_id, book_id, page) DO UPDATE
      SET excerpt = COALESCE(wrestler_book_citations.excerpt, EXCLUDED.excerpt)
    RETURNING id, (xmax = 0) AS created
  `);
  return rows[0]!;
}

export async function findOrCreateRun(
  db: Db,
  wrestlerId: number,
  input: {
    territory_id: number;
    start_year: number | null;
    start_month: number | null;
    end_year: number | null;
    end_month: number | null;
    role_during_run: string | null;
    ring_name_during_run: string | null;
    primary_run: boolean;
    notes: string | null;
  },
): Promise<{ id: number; created: boolean }> {
  const existing = await db.execute<{ id: number }>(sql`
    SELECT id FROM wrestler_territory_runs
     WHERE wrestler_id = ${wrestlerId}
       AND territory_id = ${input.territory_id}
       AND COALESCE(start_year, 0) = COALESCE(${input.start_year}, 0)
       AND COALESCE(ring_name_during_run, '') = COALESCE(${input.ring_name_during_run}, '')
     LIMIT 1
  `);
  if (existing[0]) return { id: existing[0].id, created: false };

  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO wrestler_territory_runs (wrestler_id, territory_id, start_year, start_month,
                                         end_year, end_month, role_during_run,
                                         ring_name_during_run, primary_run, notes)
    VALUES (${wrestlerId}, ${input.territory_id}, ${input.start_year}, ${input.start_month},
            ${input.end_year}, ${input.end_month}, ${input.role_during_run},
            ${input.ring_name_during_run}, ${input.primary_run}, ${input.notes})
    RETURNING id
  `);
  return { id: inserted[0]!.id, created: true };
}

export async function getWrestlerFormOptions(db: Db): Promise<{
  roles: string[];
  statuses: string[];
}> {
  const [roles, statuses] = await Promise.all([
    db.execute<{ v: string }>(
      sql`SELECT DISTINCT primary_role AS v FROM wrestlers WHERE primary_role IS NOT NULL ORDER BY primary_role`,
    ),
    db.execute<{ v: string }>(
      sql`SELECT DISTINCT midcard_files_status AS v FROM wrestlers WHERE midcard_files_status IS NOT NULL ORDER BY midcard_files_status`,
    ),
  ]);
  return { roles: roles.map((r) => r.v), statuses: statuses.map((r) => r.v) };
}

export async function getPendingNamePrefill(db: Db, pendingId: number): Promise<string | null> {
  const rows = await db.execute<{ printed_name: string }>(
    sql`SELECT printed_name FROM pending_wrestlers WHERE id = ${pendingId}`,
  );
  return rows[0]?.printed_name ?? null;
}

import { fuzzy, normalizeName } from "@/lib/dedup";

export type RepointReport = { table: string; rows: number };

export type MergeWrestlersResult = {
  survivorId: number;
  duplicateId: number;
  fieldsFilled: number;
  repointed: RepointReport[];
  duplicateDeleted: boolean;
};

type MergeFillableSpec = { col: string; type: "text" | "int" | "bool" };
const FILLABLE_WRESTLER_COLS: MergeFillableSpec[] = [
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

function isBlankWrestlerField(v: unknown, t: MergeFillableSpec["type"]): boolean {
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
      if (!isBlankWrestlerField(survivor[col], type)) continue;
      if (isBlankWrestlerField(duplicate[col], type)) continue;
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

    // Tables with a UNIQUE involving wrestler_id: drop duplicate's row when
    // survivor already has the same key, then UPDATE the rest.
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
 * Block by normalized first letter, then score with `fuzzy` and return matches above
 * the threshold. Threshold defaults to 92, mirroring the Python ingest's WRatio cutoff.
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

  return rows
    .map((r) => ({
      id: r.id,
      primary_ring_name: r.primary_ring_name,
      score: fuzzy(target[0]!.primary_ring_name, r.primary_ring_name),
    }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
