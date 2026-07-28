import { afterAll, describe, expect, it } from "vitest";
import { markets, territories, territory_eras, territory_market_runs } from "@/lib/db/schema";
import { buildMapDataWith } from "@/lib/map/build";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

type Tx = Parameters<Parameters<typeof withTx>[0]>[0];

/**
 * Two promotions sharing Texas plus one that never held turf, which is enough
 * to exercise every rule the map depends on: the colour gate, the era join, the
 * tier roll-up, co-owned towns, and proximity deciding a contested state.
 */
async function seedMap(tx: Tx) {
  const [houston] = await tx
    .insert(territories)
    .values({ name: "Test Houston Office", map_color: "#55708a", headquarters_city: "Houston" })
    .returning();
  const [dallas] = await tx
    .insert(territories)
    .values({ name: "Test Dallas Office", map_color: "#2e6f95", headquarters_city: "Dallas" })
    .returning();
  // No colour: a sanctioning body that never ran a card must stay off the map.
  const [alliance] = await tx
    .insert(territories)
    .values({ name: "Test Alliance", map_color: null })
    .returning();

  await tx.insert(territory_eras).values([
    {
      territory_id: houston.id,
      from_year: 1950,
      to_year: 1960,
      states: ["TX"],
      promoter: "Morris Sigel",
      confidence: "high",
    },
    {
      territory_id: dallas.id,
      from_year: 1950,
      to_year: 1960,
      states: ["TX"],
      promoter: "Ed McLemore",
      confidence: "high",
    },
    {
      territory_id: alliance.id,
      from_year: 1950,
      to_year: 1960,
      states: ["TX"],
      confidence: "high",
    },
  ]);

  const inserted = await tx
    .insert(markets)
    .values([
      { name: "Test Houston", state: "TX", country: "US", lat: 29.76, lon: -95.369 },
      { name: "Test Dallas", state: "TX", country: "US", lat: 32.777, lon: -96.797 },
      { name: "Test Waco", state: "TX", country: "US", lat: 31.549, lon: -97.146 },
    ])
    .returning();
  const [mHouston, mDallas, mWaco] = inserted;

  await tx.insert(territory_market_runs).values([
    {
      territory_id: houston.id,
      market_id: mHouston.id,
      from_year: 1950,
      to_year: 1960,
      tier: "Primary",
      confidence: "high",
    },
    {
      territory_id: dallas.id,
      market_id: mDallas.id,
      from_year: 1950,
      to_year: 1960,
      tier: "Primary",
      confidence: "high",
    },
    // Waco is run by both, and by Dallas only for part of the span. That makes
    // it a co-owned town and exercises the tier roll-up.
    {
      territory_id: houston.id,
      market_id: mWaco.id,
      from_year: 1950,
      to_year: 1960,
      tier: "Tertiary",
      confidence: "medium",
    },
    {
      territory_id: dallas.id,
      market_id: mWaco.id,
      from_year: 1955,
      to_year: 1960,
      tier: "Secondary",
      confidence: "medium",
    },
    // The alliance has a town but no colour, so nothing of it should appear.
    {
      territory_id: alliance.id,
      market_id: mHouston.id,
      from_year: 1950,
      to_year: 1960,
      tier: "Primary",
      confidence: "high",
    },
  ]);

  return { houston, dallas, alliance, mHouston, mDallas, mWaco };
}

describe("buildMapData", () => {
  it("returns only promotions that have a colour and an era", async () => {
    await withTx(async (tx) => {
      const { houston, dallas, alliance } = await seedMap(tx);
      const data = await buildMapDataWith(tx);

      const ids = data.territories.map((t) => t.id);
      expect(ids).toContain(String(houston.id));
      expect(ids).toContain(String(dallas.id));
      // A null map_color is how alliances and joint ventures stay off the map.
      expect(ids).not.toContain(String(alliance.id));
    });
  });

  it("derives each promotion's span from its eras", async () => {
    await withTx(async (tx) => {
      const { houston } = await seedMap(tx);
      const data = await buildMapDataWith(tx);
      const t = data.territories.find((x) => x.id === String(houston.id));
      expect(t).toBeDefined();
      expect(t?.startYear).toBe(1950);
      expect(t?.endYear).toBe(1960);
    });
  });

  it("carries eras through structured, so the panel can pick one by year", async () => {
    await withTx(async (tx) => {
      const { houston } = await seedMap(tx);
      const data = await buildMapDataWith(tx);
      const t = data.territories.find((x) => x.id === String(houston.id));
      expect(t?.eras).toHaveLength(1);
      expect(t?.eras?.[0]).toMatchObject({
        fromYear: 1950,
        toYear: 1960,
        promoter: "Morris Sigel",
        states: ["TX"],
      });
    });
  });

  it("gives a co-owned town both owners and its highest tier", async () => {
    await withTx(async (tx) => {
      const { houston, dallas, mWaco } = await seedMap(tx);
      const data = await buildMapDataWith(tx);
      const waco = data.markets.find((m) => m.id === String(mWaco.id));
      expect(waco).toBeDefined();
      expect(waco?.territoryIds).toHaveLength(2);
      expect(waco?.territoryIds).toEqual(
        expect.arrayContaining([String(houston.id), String(dallas.id)]),
      );
      // Tertiary under one office, Secondary under the other: the marker takes
      // the larger of the two.
      expect(waco?.tier).toBe("Secondary");
      expect(waco?.startYear).toBe(1950);
    });
  });

  it("carries every market run through as a tenure", async () => {
    await withTx(async (tx) => {
      const { dallas, mWaco } = await seedMap(tx);
      const data = await buildMapDataWith(tx);
      const late = data.tenures?.find(
        (t) => t.marketId === String(mWaco.id) && t.territoryId === String(dallas.id),
      );
      expect(late).toMatchObject({ fromYear: 1955, toYear: 1960, tier: "Secondary" });
    });
  });

  it("assigns a contested state's counties by which office is nearer", async () => {
    await withTx(async (tx) => {
      const { houston, dallas } = await seedMap(tx);
      const data = await buildMapDataWith(tx);

      const ownerOf = (fips: string, year: number) =>
        data.assignments.find((a) => a.fips === fips && a.fromYear <= year && year <= a.toYear)
          ?.territoryId;

      // Harris County is Houston; Dallas County is Dallas. Both promotions
      // claim all of Texas, so only proximity can be deciding this.
      expect(ownerOf("48201", 1955)).toBe(String(houston.id));
      expect(ownerOf("48113", 1955)).toBe(String(dallas.id));
    });
  });

  it("leaves counties beyond every market's reach unowned", async () => {
    await withTx(async (tx) => {
      await seedMap(tx);
      const data = await buildMapDataWith(tx);
      // El Paso County is about 1000 km from the nearest seeded town, well past
      // the 320 km cap, so nobody should hold it.
      const elPaso = data.assignments.filter((a) => a.fips === "48141");
      expect(elPaso).toHaveLength(0);
    });
  });

  it("draws nothing at all when no promotion has a colour", async () => {
    await withTx(async (tx) => {
      const [t] = await tx
        .insert(territories)
        .values({ name: "Test Colourless", map_color: null })
        .returning();
      await tx.insert(territory_eras).values({
        territory_id: t.id,
        from_year: 1950,
        to_year: 1960,
        states: ["TX"],
        confidence: "high",
      });
      const data = await buildMapDataWith(tx);
      expect(data.territories).toHaveLength(0);
      expect(data.assignments).toHaveLength(0);
      expect(data.markets).toHaveLength(0);
    });
  });
});
