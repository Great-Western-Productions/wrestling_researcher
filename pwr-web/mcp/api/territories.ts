import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

export type TerritoryUpsertInput = {
  cagematch_id: string;
  name: string;
  country: string | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  year_founded: number | null;
  year_closed: number | null;
  notes: string | null;
};

export type TerritoryUpsertResult = {
  status: "inserted" | "matched" | "skipped";
  id: number;
};

/**
 * Port of `bibliography/merge_cagematch_promotions.py` upsert semantics:
 *  1. cagematch_id already present  -> skipped
 *  2. exact (case-insensitive) name match -> matched, set cagematch_id only
 *  3. otherwise insert; on UNIQUE(name) collision, disambiguate with city or "(cm<id>)"
 *
 * Curator-edited fields are never overwritten on a match.
 */
export async function upsertTerritoryByCagematch(
  db: Db,
  input: TerritoryUpsertInput,
): Promise<TerritoryUpsertResult> {
  return db.transaction(async (tx) => {
    const byCm = await tx.execute<{ id: number }>(
      sql`SELECT id FROM territories WHERE cagematch_id = ${input.cagematch_id} LIMIT 1`,
    );
    if (byCm[0]) return { status: "skipped", id: byCm[0].id };

    const byName = await tx.execute<{ id: number; cagematch_id: string | null }>(
      sql`SELECT id, cagematch_id FROM territories WHERE LOWER(name) = LOWER(${input.name}) LIMIT 1`,
    );
    if (byName[0] && (byName[0].cagematch_id === null || byName[0].cagematch_id === "")) {
      await tx.execute(sql`
        UPDATE territories
           SET cagematch_id = ${input.cagematch_id},
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${byName[0].id}
      `);
      return { status: "matched", id: byName[0].id };
    }

    let insertName = input.name;
    const collides = async (n: string) => {
      const rows = await tx.execute<{ id: number }>(
        sql`SELECT id FROM territories WHERE name = ${n} LIMIT 1`,
      );
      return rows.length > 0;
    };
    if (await collides(insertName)) {
      const disambig = input.headquarters_city ?? input.headquarters_state ?? "?";
      insertName = `${input.name} (${disambig})`;
      if (await collides(insertName)) {
        insertName = `${input.name} (cm${input.cagematch_id})`;
      }
    }

    const inserted = await tx.execute<{ id: number }>(sql`
      INSERT INTO territories (name, cagematch_id, country, headquarters_city,
                               headquarters_state, year_founded, year_closed, notes)
      VALUES (${insertName}, ${input.cagematch_id}, ${input.country},
              ${input.headquarters_city}, ${input.headquarters_state},
              ${input.year_founded}, ${input.year_closed}, ${input.notes})
      RETURNING id
    `);
    return { status: "inserted", id: inserted[0]!.id };
  });
}
