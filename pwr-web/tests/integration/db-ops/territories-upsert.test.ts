import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { upsertTerritoryByCagematch } from "@/lib/db-ops/territories";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("upsertTerritoryByCagematch", () => {
  it("inserts a new territory and returns status=inserted with the new id", async () => {
    await withTx(async (tx) => {
      const result = await upsertTerritoryByCagematch(tx, {
        cagematch_id: "999",
        name: "Brand New Promotion",
        country: "US",
        headquarters_city: "Tampa",
        headquarters_state: "FL",
        year_founded: 1985,
        year_closed: null,
        notes: "Imported from cagematch.",
      });
      expect(result.status).toBe("inserted");
      expect(typeof result.id).toBe("number");

      const rows = await tx.execute<{ name: string; cagematch_id: string }>(
        sql`SELECT name, cagematch_id FROM territories WHERE id = ${result.id}`,
      );
      expect(rows[0]).toMatchObject({ name: "Brand New Promotion", cagematch_id: "999" });
    });
  });

  it("returns status=matched and sets only cagematch_id on the existing row", async () => {
    await withTx(async (tx) => {
      const inserted = await tx.execute<{ id: number }>(sql`
        INSERT INTO territories (name, headquarters_city, year_founded)
        VALUES ('Existing Promotion', 'Memphis', 1977)
        RETURNING id
      `);
      const existingId = inserted[0]!.id;

      const result = await upsertTerritoryByCagematch(tx, {
        cagematch_id: "1234",
        name: "Existing Promotion",
        country: "US",
        headquarters_city: "Should Not Overwrite",
        headquarters_state: "TN",
        year_founded: 9999,
        year_closed: null,
        notes: "Imported note (should not overwrite).",
      });
      expect(result).toEqual({ status: "matched", id: existingId });

      const rows = await tx.execute<{
        cagematch_id: string;
        headquarters_city: string;
        year_founded: number;
      }>(
        sql`SELECT cagematch_id, headquarters_city, year_founded FROM territories WHERE id = ${existingId}`,
      );
      expect(rows[0]).toMatchObject({
        cagematch_id: "1234",
        headquarters_city: "Memphis",
        year_founded: 1977,
      });
    });
  });

  it("returns status=skipped when the cagematch_id is already present", async () => {
    await withTx(async (tx) => {
      const inserted = await tx.execute<{ id: number }>(sql`
        INSERT INTO territories (name, cagematch_id) VALUES ('Already Linked', '777')
        RETURNING id
      `);
      const existingId = inserted[0]!.id;

      const result = await upsertTerritoryByCagematch(tx, {
        cagematch_id: "777",
        name: "Some Other Name",
        country: null,
        headquarters_city: null,
        headquarters_state: null,
        year_founded: null,
        year_closed: null,
        notes: null,
      });
      expect(result).toEqual({ status: "skipped", id: existingId });
    });
  });

  it("disambiguates the inserted name when an unrelated row owns the name with a different cagematch_id", async () => {
    await withTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO territories (name, cagematch_id) VALUES ('NWA Big Town', '99')
      `);
      const result = await upsertTerritoryByCagematch(tx, {
        cagematch_id: "12",
        name: "NWA Big Town",
        country: "US",
        headquarters_city: "Dallas",
        headquarters_state: "TX",
        year_founded: 1960,
        year_closed: null,
        notes: null,
      });
      expect(result.status).toBe("inserted");

      const rows = await tx.execute<{ name: string }>(
        sql`SELECT name FROM territories WHERE id = ${result.id}`,
      );
      expect(rows[0]?.name).toBe("NWA Big Town (Dallas)");
    });
  });
});
