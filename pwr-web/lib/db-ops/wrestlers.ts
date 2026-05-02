import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getInt, getStr } from "@/lib/actions/_helpers";
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
    fromPending: getInt(form, "from_pending"),
  };
}

export type InsertWrestlerResult = {
  id: number;
  /** When promoting from a pending row: how many ranking_entries got backfilled. */
  rankingEntriesBackfilled: number;
};

export async function insertWrestler(
  db: Db,
  input: WrestlerInput,
): Promise<InsertWrestlerResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: number }>(sql`
      INSERT INTO wrestlers (legal_name, primary_ring_name, other_ring_names, born_date,
                             died_date, living, debut_year, retired_year, primary_role,
                             hometown_billed, hometown_real, finisher, style, socials,
                             convention_status, last_known_appearance, footage_notes,
                             midcard_files_status, midcard_files_priority,
                             why_they_mattered, notes)
      VALUES (${input.legal_name}, ${input.primary_ring_name}, ${input.other_ring_names},
              ${input.born_date}, ${input.died_date}, ${input.living}, ${input.debut_year},
              ${input.retired_year}, ${input.primary_role}, ${input.hometown_billed},
              ${input.hometown_real}, ${input.finisher}, ${input.style}, ${input.socials},
              ${input.convention_status}, ${input.last_known_appearance},
              ${input.footage_notes}, ${input.midcard_files_status},
              ${input.midcard_files_priority}, ${input.why_they_mattered}, ${input.notes})
      RETURNING id
    `);
    const id = inserted[0]!.id;

    let rankingEntriesBackfilled = 0;
    if (input.fromPending) {
      await tx.execute(
        sql`UPDATE pending_wrestlers SET resolved_wrestler_id = ${id} WHERE id = ${input.fromPending}`,
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

export async function getPendingNamePrefill(
  db: Db,
  pendingId: number,
): Promise<string | null> {
  const rows = await db.execute<{ printed_name: string }>(
    sql`SELECT printed_name FROM pending_wrestlers WHERE id = ${pendingId}`,
  );
  return rows[0]?.printed_name ?? null;
}
