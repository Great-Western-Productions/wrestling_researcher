import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  pending_wrestlers,
  periodical_issues,
  periodicals,
  ranking_entries,
  ranking_lists,
  territories,
  wrestlers,
} from "@/lib/db/schema";
import { insertPeriodical } from "@/lib/db-ops/periodicals";
import { insertRun } from "@/lib/db-ops/runs";
import { insertTerritory } from "@/lib/db-ops/territories";
import { insertWrestler } from "@/lib/db-ops/wrestlers";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("insertPeriodical", () => {
  it("creates a periodical with defaults", async () => {
    const id = await withTx((tx) =>
      insertPeriodical(tx, {
        title: "PWI",
        publisher: null,
        country: "US",
        language: "English",
        year_started: 1979,
        year_ended: null,
        frequency: "monthly",
        type: "magazine",
        parent_company: null,
        notes: null,
        issue_count_known: null,
        archive_in_collection: true,
        source_url: null,
        confidence: "medium",
      }),
    );
    expect(id).toBeGreaterThan(0);
  });
});

describe("insertTerritory", () => {
  it("creates a territory", async () => {
    const id = await withTx((tx) =>
      insertTerritory(tx, {
        name: "Test Territory",
        short_name: "TT",
        region: "South",
        nwa_member: true,
        headquarters_city: "Atlanta",
        headquarters_state: "GA",
        year_founded: 1985,
        year_closed: null,
        promoter_lineage: null,
        notes: null,
      }),
    );
    expect(id).toBeGreaterThan(0);
  });
});

describe("insertWrestler", () => {
  it("creates a wrestler with sensible defaults", async () => {
    const result = await withTx((tx) =>
      insertWrestler(tx, {
        legal_name: null,
        primary_ring_name: "New Wrestler",
        other_ring_names: null,
        born_date: null,
        died_date: null,
        living: null,
        debut_year: null,
        retired_year: null,
        primary_role: null,
        hometown_billed: null,
        hometown_real: null,
        finisher: null,
        style: null,
        socials: null,
        convention_status: null,
        last_known_appearance: null,
        footage_notes: null,
        midcard_files_status: "queued",
        midcard_files_priority: null,
        why_they_mattered: null,
        notes: null,
        height_inches: null,
        weight_lbs: null,
        bio: null,
        fromPending: null,
      }),
    );
    expect(result.id).toBeGreaterThan(0);
    expect(result.rankingEntriesBackfilled).toBe(0);
  });

  it("when promoting from pending, links pending row + backfills ranking_entries", async () => {
    const result = await withTx(async (tx) => {
      const [periodical] = await tx.insert(periodicals).values({ title: "PWI" }).returning();
      const [issue] = await tx
        .insert(periodical_issues)
        .values({ periodical_id: periodical!.id, publication_date: "1985-07-01" })
        .returning();
      const [list] = await tx
        .insert(ranking_lists)
        .values({
          issue_id: issue!.id,
          list_label: "PWI Top 10",
          list_scope: "global",
        })
        .returning();
      const [pending] = await tx
        .insert(pending_wrestlers)
        .values({
          printed_name: "Some Guy",
          normalized_name: "some guy",
          occurrence_count: 2,
        })
        .returning();
      // Two ranking_entries pointing at the pending row
      await tx.insert(ranking_entries).values([
        {
          ranking_list_id: list!.id,
          rank: 1,
          entry_name: "Some Guy",
          pending_wrestler_id: pending!.id,
        },
        {
          ranking_list_id: list!.id,
          rank: 2,
          entry_name: "Some Guy",
          pending_wrestler_id: pending!.id,
        },
      ]);

      const created = await insertWrestler(tx, {
        legal_name: null,
        primary_ring_name: "Some Guy",
        other_ring_names: null,
        born_date: null,
        died_date: null,
        living: null,
        debut_year: null,
        retired_year: null,
        primary_role: null,
        hometown_billed: null,
        hometown_real: null,
        finisher: null,
        style: null,
        socials: null,
        convention_status: null,
        last_known_appearance: null,
        footage_notes: null,
        midcard_files_status: "queued",
        midcard_files_priority: null,
        why_they_mattered: null,
        notes: null,
        height_inches: null,
        weight_lbs: null,
        bio: null,
        fromPending: pending!.id,
      });

      const reloadedPending = await tx.execute<{ resolved_wrestler_id: number | null }>(
        sql`SELECT resolved_wrestler_id FROM pending_wrestlers WHERE id = ${pending!.id}`,
      );
      const entries = await tx.execute<{
        wrestler_id: number | null;
        pending_wrestler_id: number | null;
      }>(
        sql`SELECT wrestler_id, pending_wrestler_id FROM ranking_entries WHERE ranking_list_id = ${list!.id}`,
      );

      return { created, resolved: reloadedPending[0]?.resolved_wrestler_id, entries: [...entries] };
    });

    expect(result.created.rankingEntriesBackfilled).toBe(2);
    expect(result.resolved).toBe(result.created.id);
    expect(result.entries.every((e) => e.wrestler_id === result.created.id)).toBe(true);
    expect(result.entries.every((e) => e.pending_wrestler_id === null)).toBe(true);
  });
});

describe("insertRun", () => {
  it("creates a wrestler-territory run", async () => {
    const result = await withTx(async (tx) => {
      const [w] = await tx.insert(wrestlers).values({ primary_ring_name: "W" }).returning();
      const [t] = await tx.insert(territories).values({ name: "T" }).returning();
      const id = await insertRun(tx, {
        wrestler_id: w!.id,
        territory_id: t!.id,
        start_year: 1985,
        start_month: 6,
        end_year: 1986,
        end_month: null,
        role_during_run: "main event",
        ring_name_during_run: null,
        primary_run: true,
        notes: null,
      });
      return id;
    });
    expect(result).toBeGreaterThan(0);
  });
});
