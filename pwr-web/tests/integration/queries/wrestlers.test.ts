import { afterAll, describe, expect, it } from "vitest";
import { territories, wrestler_territory_runs, wrestlers } from "@/lib/db/schema";
import { getWrestlerById, listWrestlers, runsForWrestler } from "@/lib/queries/wrestlers";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("listWrestlers", () => {
  it("returns all wrestlers ordered by name", async () => {
    const result = await withTx(async (tx) => {
      await tx
        .insert(wrestlers)
        .values([
          { primary_ring_name: "Zorro" },
          { primary_ring_name: "Apollo" },
          { primary_ring_name: "Mantis" },
        ]);
      return listWrestlers(tx, {});
    });
    expect(result.rows.map((w) => w.primary_ring_name)).toEqual(["Apollo", "Mantis", "Zorro"]);
    expect(result.total).toBe(3);
  });

  it("searches across primary, legal, and other ring names (q)", async () => {
    const result = await withTx(async (tx) => {
      await tx
        .insert(wrestlers)
        .values([
          { primary_ring_name: "The Wizard", legal_name: "Walter Smith" },
          { primary_ring_name: "Goliath", other_ring_names: "Big Walter" },
          { primary_ring_name: "Other" },
        ]);
      return listWrestlers(tx, { q: "walter" });
    });
    expect(result.rows.map((w) => w.primary_ring_name).sort()).toEqual(["Goliath", "The Wizard"]);
  });

  it("filters by territory via join", async () => {
    const result = await withTx(async (tx) => {
      const [t] = await tx.insert(territories).values({ name: "T" }).returning();
      const [w1] = await tx.insert(wrestlers).values({ primary_ring_name: "InT" }).returning();
      await tx.insert(wrestlers).values({ primary_ring_name: "NotInT" });
      await tx.insert(wrestler_territory_runs).values({ wrestler_id: w1!.id, territory_id: t!.id });
      return listWrestlers(tx, { territoryId: t!.id });
    });
    expect(result.rows.map((w) => w.primary_ring_name)).toEqual(["InT"]);
  });

  it("filters living=1 and living=0", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(wrestlers).values([
        { primary_ring_name: "Alive", living: true },
        { primary_ring_name: "Dead", living: false },
        { primary_ring_name: "Unknown", living: null },
      ]);
      return Promise.all([listWrestlers(tx, { living: "1" }), listWrestlers(tx, { living: "0" })]);
    });
    expect(result[0].rows.map((w) => w.primary_ring_name)).toEqual(["Alive"]);
    expect(result[1].rows.map((w) => w.primary_ring_name)).toEqual(["Dead"]);
  });
});

describe("getWrestlerById", () => {
  it("returns the wrestler or null", async () => {
    const { found, missing } = await withTx(async (tx) => {
      const [w] = await tx.insert(wrestlers).values({ primary_ring_name: "Found Me" }).returning();
      return {
        found: await getWrestlerById(tx, w!.id),
        missing: await getWrestlerById(tx, 9_999),
      };
    });
    expect(found?.primary_ring_name).toBe("Found Me");
    expect(missing).toBeNull();
  });
});

describe("runsForWrestler", () => {
  it("returns runs joined with territory metadata, ordered by start_year", async () => {
    const result = await withTx(async (tx) => {
      const [w] = await tx.insert(wrestlers).values({ primary_ring_name: "Traveler" }).returning();
      const [t1] = await tx.insert(territories).values({ name: "First" }).returning();
      const [t2] = await tx.insert(territories).values({ name: "Second" }).returning();
      await tx.insert(wrestler_territory_runs).values([
        { wrestler_id: w!.id, territory_id: t2!.id, start_year: 1990 },
        { wrestler_id: w!.id, territory_id: t1!.id, start_year: 1985 },
      ]);
      return runsForWrestler(tx, w!.id);
    });
    expect(result.map((r) => r.terr_name)).toEqual(["First", "Second"]);
  });
});
