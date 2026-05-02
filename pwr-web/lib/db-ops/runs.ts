import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getCheckbox, getInt, getStr } from "@/lib/actions/_helpers";
import { ValidationError } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type RunInput = {
  wrestler_id: number;
  territory_id: number;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  role_during_run: string | null;
  ring_name_during_run: string | null;
  primary_run: number;
  notes: string | null;
};

export function parseRunInput(form: FormData): RunInput {
  const wrestler_id = getInt(form, "wrestler_id");
  const territory_id = getInt(form, "territory_id");
  if (!wrestler_id || !territory_id) {
    throw new ValidationError("Wrestler and territory are required.");
  }
  return {
    wrestler_id,
    territory_id,
    start_year: getInt(form, "start_year"),
    start_month: getInt(form, "start_month"),
    end_year: getInt(form, "end_year"),
    end_month: getInt(form, "end_month"),
    role_during_run: getStr(form, "role_during_run"),
    ring_name_during_run: getStr(form, "ring_name_during_run"),
    primary_run: getCheckbox(form, "primary_run"),
    notes: getStr(form, "notes"),
  };
}

export async function insertRun(db: Db, input: RunInput): Promise<number> {
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO wrestler_territory_runs (wrestler_id, territory_id, start_year, start_month,
                                         end_year, end_month, role_during_run,
                                         ring_name_during_run, primary_run, notes)
    VALUES (${input.wrestler_id}, ${input.territory_id}, ${input.start_year},
            ${input.start_month}, ${input.end_year}, ${input.end_month},
            ${input.role_during_run}, ${input.ring_name_during_run}, ${input.primary_run},
            ${input.notes})
    RETURNING id
  `);
  return rows[0]!.id;
}

export async function getRunFormOptions(db: Db): Promise<{
  wrestlers: Array<{ id: number; primary_ring_name: string }>;
  territories: Array<{ id: number; name: string; short_name: string | null }>;
}> {
  const [w, t] = await Promise.all([
    db.execute<{ id: number; primary_ring_name: string }>(
      sql`SELECT id, primary_ring_name FROM wrestlers ORDER BY primary_ring_name`,
    ),
    db.execute<{ id: number; name: string; short_name: string | null }>(
      sql`SELECT id, name, short_name FROM territories ORDER BY name`,
    ),
  ]);
  return { wrestlers: [...w], territories: [...t] };
}
