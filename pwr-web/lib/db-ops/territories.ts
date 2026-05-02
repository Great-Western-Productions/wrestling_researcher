import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getCheckbox, getInt, getStr } from "@/lib/actions/_helpers";
import { ValidationError } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type TerritoryInput = {
  name: string;
  short_name: string | null;
  region: string | null;
  nwa_member: number;
  headquarters_city: string | null;
  headquarters_state: string | null;
  year_founded: number | null;
  year_closed: number | null;
  promoter_lineage: string | null;
  notes: string | null;
};

export function parseTerritoryInput(form: FormData): TerritoryInput {
  const name = getStr(form, "name");
  if (!name) throw new ValidationError("Name is required.");
  return {
    name,
    short_name: getStr(form, "short_name"),
    region: getStr(form, "region"),
    nwa_member: getCheckbox(form, "nwa_member"),
    headquarters_city: getStr(form, "headquarters_city"),
    headquarters_state: getStr(form, "headquarters_state"),
    year_founded: getInt(form, "year_founded"),
    year_closed: getInt(form, "year_closed"),
    promoter_lineage: getStr(form, "promoter_lineage"),
    notes: getStr(form, "notes"),
  };
}

export async function insertTerritory(db: Db, input: TerritoryInput): Promise<number> {
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO territories (name, short_name, region, nwa_member, headquarters_city,
                             headquarters_state, year_founded, year_closed,
                             promoter_lineage, notes)
    VALUES (${input.name}, ${input.short_name}, ${input.region}, ${input.nwa_member},
            ${input.headquarters_city}, ${input.headquarters_state}, ${input.year_founded},
            ${input.year_closed}, ${input.promoter_lineage}, ${input.notes})
    RETURNING id
  `);
  return rows[0]!.id;
}

export async function getTerritoryRegions(db: Db): Promise<string[]> {
  const rows = await db.execute<{ v: string }>(
    sql`SELECT DISTINCT region AS v FROM territories WHERE region IS NOT NULL ORDER BY region`,
  );
  return rows.map((r) => r.v);
}
