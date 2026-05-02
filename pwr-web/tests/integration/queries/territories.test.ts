import { afterAll, describe, expect, it } from "vitest";
import { territories, wrestler_territory_runs, wrestlers } from "@/lib/db/schema";
import {
  getTerritoryById,
  listTerritories,
  runsForTerritory,
} from "@/lib/queries/territories";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("listTerritories", () => {
  it("returns territories with run_count, ordered by region then year_founded then name", async () => {
    const result = await withTx(async (tx) => {
      const [tA] = await tx
        .insert(territories)
        .values({ name: "Alpha", region: "South", year_founded: 1970 })
        .returning();
      await tx.insert(territories).values([
        { name: "Beta", region: "North", year_founded: 1985 },
        { name: "Gamma", region: "South", year_founded: 1965 },
      ]);
      const [w] = await tx.insert(wrestlers).values({ primary_ring_name: "X" }).returning();
      await tx
        .insert(wrestler_territory_runs)
        .values({ wrestler_id: w!.id, territory_id: tA!.id });
      return listTerritories(tx, {});
    });
    expect(result.rows.map((r) => r.name)).toEqual(["Beta", "Gamma", "Alpha"]);
    const alpha = result.rows.find((r) => r.name === "Alpha")!;
    expect(alpha.run_count).toBe(1);
  });

  it("filters by NWA membership and search query", async () => {
    const result = await withTx(async (tx) => {
      await tx.insert(territories).values([
        { name: "WCW", nwa_member: true, headquarters_city: "Atlanta" },
        { name: "WWF", nwa_member: false, headquarters_city: "Stamford" },
        { name: "AWA", nwa_member: true, headquarters_city: "Minneapolis" },
      ]);
      return Promise.all([
        listTerritories(tx, { nwa: "1" }),
        listTerritories(tx, { q: "atl" }),
      ]);
    });
    expect(result[0].rows.map((r) => r.name).sort()).toEqual(["AWA", "WCW"]);
    expect(result[1].rows.map((r) => r.name)).toEqual(["WCW"]);
  });
});

describe("getTerritoryById", () => {
  it("returns the territory or null", async () => {
    const { found, missing } = await withTx(async (tx) => {
      const [t] = await tx.insert(territories).values({ name: "T" }).returning();
      return {
        found: await getTerritoryById(tx, t!.id),
        missing: await getTerritoryById(tx, 9_999),
      };
    });
    expect(found?.name).toBe("T");
    expect(missing).toBeNull();
  });
});

describe("runsForTerritory", () => {
  it("returns runs joined with wrestler metadata", async () => {
    const result = await withTx(async (tx) => {
      const [t] = await tx.insert(territories).values({ name: "T" }).returning();
      const [w1] = await tx
        .insert(wrestlers)
        .values({ primary_ring_name: "First", legal_name: "F.L." })
        .returning();
      const [w2] = await tx
        .insert(wrestlers)
        .values({ primary_ring_name: "Second" })
        .returning();
      await tx.insert(wrestler_territory_runs).values([
        { wrestler_id: w2!.id, territory_id: t!.id, start_year: 1990 },
        { wrestler_id: w1!.id, territory_id: t!.id, start_year: 1985 },
      ]);
      return runsForTerritory(tx, t!.id);
    });
    expect(result.map((r) => r.primary_ring_name)).toEqual(["First", "Second"]);
    expect(result[0].legal_name).toBe("F.L.");
  });
});
