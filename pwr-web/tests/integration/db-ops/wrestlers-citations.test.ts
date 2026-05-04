import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { categories } from "@/lib/db/schema";
import { insertBook } from "@/lib/db-ops/books";
import { insertTerritory } from "@/lib/db-ops/territories";
import {
  addCitation,
  findOrCreateRun,
  findWrestlerByRingName,
  insertWrestler,
  patchWrestlerFillBlanks,
} from "@/lib/db-ops/wrestlers";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

const blankWrestler = {
  legal_name: null,
  primary_ring_name: "Test Wrestler",
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
};

describe("findWrestlerByRingName", () => {
  it("finds case-insensitively", async () => {
    await withTx(async (tx) => {
      await insertWrestler(tx, blankWrestler);
      const found = await findWrestlerByRingName(tx, "test wrestler");
      expect(found?.primary_ring_name).toBe("Test Wrestler");
    });
  });

  it("returns null for unknown names", async () => {
    await withTx(async (tx) => {
      const found = await findWrestlerByRingName(tx, "Nobody");
      expect(found).toBeNull();
    });
  });
});

describe("patchWrestlerFillBlanks", () => {
  it("fills NULL columns and leaves populated columns alone", async () => {
    await withTx(async (tx) => {
      const { id } = await insertWrestler(tx, {
        ...blankWrestler,
        legal_name: "Existing Real Name",
        height_inches: null,
        weight_lbs: null,
        bio: null,
      });

      const changed = await patchWrestlerFillBlanks(tx, id, {
        legal_name: "Should Not Overwrite",
        height_inches: 73,
        weight_lbs: 220,
        bio: "Long-form bio narrative.",
      });

      // legal_name was already populated, so 3 columns changed (height, weight, bio).
      expect(changed).toBe(3);

      const rows = await tx.execute<{
        legal_name: string;
        height_inches: number;
        weight_lbs: number;
        bio: string;
      }>(sql`SELECT legal_name, height_inches, weight_lbs, bio FROM wrestlers WHERE id = ${id}`);
      expect(rows[0]).toMatchObject({
        legal_name: "Existing Real Name",
        height_inches: 73,
        weight_lbs: 220,
        bio: "Long-form bio narrative.",
      });
    });
  });
});

describe("addCitation", () => {
  it("creates and is idempotent on (wrestler, book, page)", async () => {
    await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "reference", label: "Reference" });
      const { id: wid } = await insertWrestler(tx, blankWrestler);
      const bookId = await insertBook(tx, {
        title: "Test Book",
        subtitle: null,
        category_code: "reference",
        publisher: null,
        year_published: 1986,
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
        confidence: "high",
        authorNames: [],
        authorsAreWrestlers: false,
      });

      const first = await addCitation(tx, wid, bookId, "13", "first excerpt");
      expect(first.created).toBe(true);

      const second = await addCitation(tx, wid, bookId, "13", "second excerpt");
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);

      // Different page → new row
      const otherPage = await addCitation(tx, wid, bookId, "14", null);
      expect(otherPage.created).toBe(true);
      expect(otherPage.id).not.toBe(first.id);
    });
  });
});

describe("findOrCreateRun", () => {
  it("creates once, returns existing on the second call", async () => {
    await withTx(async (tx) => {
      const { id: wid } = await insertWrestler(tx, blankWrestler);
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

      const first = await findOrCreateRun(tx, wid, {
        territory_id: tid,
        start_year: 1986,
        start_month: null,
        end_year: null,
        end_month: null,
        role_during_run: null,
        ring_name_during_run: "Test Wrestler",
        primary_run: true,
        notes: null,
      });
      expect(first.created).toBe(true);

      const second = await findOrCreateRun(tx, wid, {
        territory_id: tid,
        start_year: 1986,
        start_month: null,
        end_year: null,
        end_month: null,
        role_during_run: null,
        ring_name_during_run: "Test Wrestler",
        primary_run: true,
        notes: null,
      });
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);
    });
  });
});
