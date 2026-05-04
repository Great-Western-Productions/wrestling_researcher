import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { listPendingWrestlers, promotePending } from "@/lib/db-ops/pending-wrestlers";
import { insertWrestler } from "@/lib/db-ops/wrestlers";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

const blank = {
  legal_name: null as string | null,
  primary_ring_name: "X",
  other_ring_names: null as string | null,
  born_date: null as string | null,
  died_date: null as string | null,
  living: null as boolean | null,
  debut_year: null as number | null,
  retired_year: null as number | null,
  primary_role: null as string | null,
  hometown_billed: null as string | null,
  hometown_real: null as string | null,
  finisher: null as string | null,
  style: null as string | null,
  socials: null as string | null,
  convention_status: null as string | null,
  last_known_appearance: null as string | null,
  footage_notes: null as string | null,
  midcard_files_status: "queued",
  midcard_files_priority: null as number | null,
  why_they_mattered: null as string | null,
  notes: null as string | null,
  height_inches: null as number | null,
  weight_lbs: null as number | null,
  bio: null as string | null,
  fromPending: null as number | null,
};

async function seedRankingFixture(tx: Parameters<Parameters<typeof withTx>[0]>[0]) {
  const periodical = await tx.execute<{ id: number }>(sql`
    INSERT INTO periodicals (title) VALUES ('PWI') RETURNING id
  `);
  const issue = await tx.execute<{ id: number }>(sql`
    INSERT INTO periodical_issues (periodical_id, publication_date)
    VALUES (${periodical[0]!.id}, '1986-08-01') RETURNING id
  `);
  const list = await tx.execute<{ id: number }>(sql`
    INSERT INTO ranking_lists (issue_id, list_label, list_scope)
    VALUES (${issue[0]!.id}, 'PWI 500', 'global') RETURNING id
  `);
  return list[0]!.id;
}

// `resolvePendingTo` is `mergePendingIntoWrestler` from lib/db-ops/merge — its
// behavior is exhaustively covered by tests/integration/actions/merge.test.ts.
// We don't re-test it here.

describe("promotePending", () => {
  it("creates a new wrestler from the pending row and resolves it", async () => {
    await withTx(async (tx) => {
      const pending = await tx.execute<{ id: number }>(sql`
        INSERT INTO pending_wrestlers (printed_name, normalized_name)
        VALUES ('Macho Man Randy Savage', 'macho man randy savage') RETURNING id
      `);
      const listId = await seedRankingFixture(tx);
      await tx.execute(sql`
        INSERT INTO ranking_entries (ranking_list_id, rank, pending_wrestler_id, entry_name)
        VALUES (${listId}, 3, ${pending[0]!.id}, 'Macho Man Randy Savage')
      `);

      const result = await promotePending(tx, pending[0]!.id);
      expect(typeof result.wrestlerId).toBe("number");
      expect(result.rankingEntriesBackfilled).toBe(1);

      const wrestler = await tx.execute<{ primary_ring_name: string }>(
        sql`SELECT primary_ring_name FROM wrestlers WHERE id = ${result.wrestlerId}`,
      );
      expect(wrestler[0]!.primary_ring_name).toBe("Macho Man Randy Savage");

      const pendingRow = await tx.execute<{ resolved_wrestler_id: number | null }>(
        sql`SELECT resolved_wrestler_id FROM pending_wrestlers WHERE id = ${pending[0]!.id}`,
      );
      expect(pendingRow[0]!.resolved_wrestler_id).toBe(result.wrestlerId);
    });
  });
});

describe("listPendingWrestlers", () => {
  it("returns unresolved rows by default, supports resolved filter, and respects limit", async () => {
    await withTx(async (tx) => {
      const { id: canon } = await insertWrestler(tx, {
        ...blank,
        primary_ring_name: "Resolved Wrestler",
      });
      await tx.execute(sql`
        INSERT INTO pending_wrestlers (printed_name, normalized_name, resolved_wrestler_id, occurrence_count)
        VALUES ('Resolved Pending', 'resolved pending', ${canon}, 5)
      `);
      await tx.execute(sql`
        INSERT INTO pending_wrestlers (printed_name, normalized_name, occurrence_count)
        VALUES ('Unresolved A', 'unresolved a', 9),
               ('Unresolved B', 'unresolved b', 3)
      `);

      const unresolved = await listPendingWrestlers(tx, { resolved: false, limit: 10 });
      expect(unresolved.map((p) => p.printed_name)).toEqual(["Unresolved A", "Unresolved B"]);

      const resolved = await listPendingWrestlers(tx, { resolved: true, limit: 10 });
      expect(resolved.map((p) => p.printed_name)).toEqual(["Resolved Pending"]);

      const limited = await listPendingWrestlers(tx, { resolved: false, limit: 1 });
      expect(limited).toHaveLength(1);
      expect(limited[0]!.printed_name).toBe("Unresolved A"); // higher occurrence_count first
    });
  });
});
