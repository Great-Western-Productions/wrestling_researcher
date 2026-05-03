import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { categories } from "@/lib/db/schema";
import { insertBook } from "@/lib/db-ops/books";
import { insertTerritory } from "@/lib/db-ops/territories";
import { findDuplicateCandidates, insertWrestler, mergeWrestlers } from "@/lib/db-ops/wrestlers";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

const blankWrestler = {
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

describe("mergeWrestlers", () => {
  it("rejects merging a wrestler into themselves", async () => {
    await withTx(async (tx) => {
      await expect(mergeWrestlers(tx, 1, 1)).rejects.toThrow(/same wrestler/i);
    });
  });

  it("repoints simple FKs, fills blank survivor fields, and deletes the duplicate", async () => {
    await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "by_wrestler", label: "By a wrestler" });
      const { id: survId } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Ric Flair",
        debut_year: 1972,
      });
      const { id: dupId } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Rick Flare",
        legal_name: "Richard Morgan Fliehr",
        finisher: "Figure-Four Leglock",
      });
      const tid = await insertTerritory(tx, {
        name: "Test Territory",
        short_name: null,
        region: null,
        nwa_member: false,
        headquarters_city: null,
        headquarters_state: null,
        year_founded: null,
        year_closed: null,
        promoter_lineage: null,
        notes: null,
      });
      await tx.execute(sql`
        INSERT INTO wrestler_territory_runs (wrestler_id, territory_id, start_year, primary_run)
        VALUES (${dupId}, ${tid}, 1981, true)
      `);
      const titleRow = await tx.execute<{ id: number }>(sql`
        INSERT INTO titles (name, territory_id) VALUES ('NWA World Heavyweight', ${tid}) RETURNING id
      `);
      await tx.execute(sql`
        INSERT INTO reigns (title_id, wrestler_id, sequence_order, is_vacancy)
        VALUES (${titleRow[0]!.id}, ${dupId}, 1, false)
      `);
      const issue = await tx.execute<{ id: number }>(sql`
        INSERT INTO periodicals (title) VALUES ('Test Mag') RETURNING id
      `);
      const issueRow = await tx.execute<{ id: number }>(sql`
        INSERT INTO periodical_issues (periodical_id, publication_date)
        VALUES (${issue[0]!.id}, '1986-01-01') RETURNING id
      `);
      const list = await tx.execute<{ id: number }>(sql`
        INSERT INTO ranking_lists (issue_id, list_label, list_scope)
        VALUES (${issueRow[0]!.id}, 'PWI 500', 'global') RETURNING id
      `);
      await tx.execute(sql`
        INSERT INTO ranking_entries (ranking_list_id, rank, wrestler_id, entry_name)
        VALUES (${list[0]!.id}, 1, ${dupId}, 'Rick Flare')
      `);

      const result = await mergeWrestlers(tx, survId, dupId);

      expect(result.duplicateDeleted).toBe(true);
      expect(result.survivorId).toBe(survId);
      expect(result.duplicateId).toBe(dupId);
      expect(result.fieldsFilled).toBeGreaterThanOrEqual(2); // legal_name + finisher

      const dupRows = await tx.execute<{ id: number }>(
        sql`SELECT id FROM wrestlers WHERE id = ${dupId}`,
      );
      expect(dupRows).toHaveLength(0);

      const surv = await tx.execute<{
        legal_name: string | null;
        finisher: string | null;
        debut_year: number | null;
      }>(sql`SELECT legal_name, finisher, debut_year FROM wrestlers WHERE id = ${survId}`);
      expect(surv[0]).toMatchObject({
        legal_name: "Richard Morgan Fliehr",
        finisher: "Figure-Four Leglock",
        debut_year: 1972,
      });

      const runs = await tx.execute<{ wrestler_id: number }>(
        sql`SELECT wrestler_id FROM wrestler_territory_runs WHERE territory_id = ${tid}`,
      );
      expect(runs.map((r) => r.wrestler_id)).toEqual([survId]);

      const reigns = await tx.execute<{ wrestler_id: number }>(
        sql`SELECT wrestler_id FROM reigns WHERE title_id = ${titleRow[0]!.id}`,
      );
      expect(reigns.map((r) => r.wrestler_id)).toEqual([survId]);

      const entries = await tx.execute<{ wrestler_id: number }>(
        sql`SELECT wrestler_id FROM ranking_entries WHERE ranking_list_id = ${list[0]!.id}`,
      );
      expect(entries.map((r) => r.wrestler_id)).toEqual([survId]);

      expect(result.repointed.find((r) => r.table === "wrestler_territory_runs")?.rows).toBe(1);
      expect(result.repointed.find((r) => r.table === "reigns")?.rows).toBe(1);
      expect(result.repointed.find((r) => r.table === "ranking_entries")?.rows).toBe(1);
    });
  });

  it("drops duplicate's reign_participants row when the survivor is already in the same reign", async () => {
    await withTx(async (tx) => {
      const { id: survId } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Survivor",
      });
      const { id: dupId } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Duplicate",
      });
      const tid = await insertTerritory(tx, {
        name: "Tag Territory",
        short_name: null,
        region: null,
        nwa_member: false,
        headquarters_city: null,
        headquarters_state: null,
        year_founded: null,
        year_closed: null,
        promoter_lineage: null,
        notes: null,
      });
      const titleRow = await tx.execute<{ id: number }>(sql`
        INSERT INTO titles (name, territory_id) VALUES ('Tag Title', ${tid}) RETURNING id
      `);
      const reign = await tx.execute<{ id: number }>(sql`
        INSERT INTO reigns (title_id, sequence_order, is_vacancy)
        VALUES (${titleRow[0]!.id}, 1, false) RETURNING id
      `);
      // Both wrestlers participate in the same reign — conflict on (reign_id, wrestler_id) after repoint.
      await tx.execute(sql`
        INSERT INTO reign_participants (reign_id, wrestler_id, position)
        VALUES (${reign[0]!.id}, ${survId}, 1), (${reign[0]!.id}, ${dupId}, 2)
      `);

      await mergeWrestlers(tx, survId, dupId);

      const rows = await tx.execute<{ wrestler_id: number; position: number }>(
        sql`SELECT wrestler_id, position FROM reign_participants WHERE reign_id = ${reign[0]!.id} ORDER BY position`,
      );
      expect(rows).toEqual([{ wrestler_id: survId, position: 1 }]);
    });
  });

  it("findDuplicateCandidates returns above-threshold matches sorted by descending score", async () => {
    await withTx(async (tx) => {
      const { id: target } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Ric Flair",
      });
      const { id: closeMatch } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Rick Flair",
      });
      const { id: looseMatch } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "Rick Flare",
      });
      await insertWrestler(tx, { ...blankWrestler, primary_ring_name: "Hulk Hogan" });

      const cands = await findDuplicateCandidates(tx, target, { threshold: 80 });
      const ids = cands.map((c) => c.id);
      expect(ids).toContain(closeMatch);
      expect(ids).toContain(looseMatch);
      expect(ids).not.toContain(target);
      // Closer name should outrank the looser one.
      expect(cands[0]!.id).toBe(closeMatch);
      // Hulk Hogan is filtered by both threshold and the "first letter" block.
      const allNames = cands.map((c) => c.primary_ring_name);
      expect(allNames.every((n) => n.toLowerCase().startsWith("r"))).toBe(true);
    });
  });

  it("drops duplicate's citation row when the survivor already has same (book, page)", async () => {
    await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "reference", label: "Reference" });
      const bookId = await insertBook(tx, {
        title: "Some Book",
        subtitle: null,
        category_code: "reference",
        publisher: null,
        year_published: null,
        isbn10: null,
        isbn13: null,
        pages: null,
        format: null,
        language: "English",
        country: null,
        subject_wrestler: null,
        era: null,
        territory_or_promotion: null,
        synopsis: null,
        source_url: null,
        confidence: "medium",
        authorNames: [],
        authorsAreWrestlers: false,
      });
      const { id: survId } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "S",
      });
      const { id: dupId } = await insertWrestler(tx, {
        ...blankWrestler,
        primary_ring_name: "D",
      });
      await tx.execute(sql`
        INSERT INTO wrestler_book_citations (wrestler_id, book_id, page, excerpt)
        VALUES (${survId}, ${bookId}, '12', 'survivor excerpt'),
               (${dupId}, ${bookId}, '12', 'duplicate excerpt'),
               (${dupId}, ${bookId}, '13', 'unique-to-dup excerpt')
      `);

      await mergeWrestlers(tx, survId, dupId);

      const rows = await tx.execute<{ page: string; excerpt: string }>(
        sql`SELECT page, excerpt FROM wrestler_book_citations WHERE wrestler_id = ${survId} ORDER BY page`,
      );
      expect(rows.map((r) => r.page)).toEqual(["12", "13"]);
      // Survivor's original excerpt for page 12 is preserved.
      expect(rows[0]!.excerpt).toBe("survivor excerpt");
    });
  });
});
