import { describe, expect, it } from "vitest";
import {
  type AssignMarket,
  type AssignTerritory,
  assignCounties,
  haversineKm,
  type Unit,
} from "@/lib/map/assign";

/**
 * Three synthetic counties in one state and one far away, so proximity and the
 * distance cap can both be exercised without loading real geometry.
 *
 * FIPS prefix 48 is Texas and 06 is California, which is what lets the state
 * mask do anything: the sweep reads the state off the prefix.
 */
const AUSTIN: [number, number] = [-97.743, 30.267];
const HOUSTON: [number, number] = [-95.369, 29.76];
const EL_PASO: [number, number] = [-106.485, 31.759];

function unit(fips: string, lon: number, lat: number): Unit {
  const postal = fips.startsWith("48") ? "TX" : fips.startsWith("06") ? "CA" : null;
  return { fips, postal, lon, lat };
}

const NEAR_AUSTIN = unit("48001", AUSTIN[0] + 0.2, AUSTIN[1] + 0.2);
const NEAR_HOUSTON = unit("48002", HOUSTON[0] + 0.2, HOUSTON[1] - 0.2);
const NEAR_EL_PASO = unit("48003", EL_PASO[0], EL_PASO[1]);

function terr(id: string, states: string[], from = 1950, to = 1960): AssignTerritory {
  return { id, states, startYear: from, endYear: to };
}

function market(
  territoryId: string,
  [lon, lat]: [number, number],
  from = 1950,
  to = 1960,
): AssignMarket {
  return { territoryId, lon, lat, fromYear: from, toYear: to };
}

const SPAN = { startYear: 1950, endYear: 1960 };

/** fips -> owner, for the given year, out of the collapsed run rows. */
function ownersIn(rows: ReturnType<typeof assignCounties>, year: number) {
  const out = new Map<string, string>();
  for (const r of rows) if (r.fromYear <= year && year <= r.toYear) out.set(r.fips, r.territoryId);
  return out;
}

describe("assignCounties", () => {
  it("fills a state solid when one promotion is the only claimant", () => {
    const rows = assignCounties(
      [terr("houston", ["TX"])],
      [market("houston", HOUSTON)],
      [NEAR_AUSTIN, NEAR_HOUSTON],
      { ...SPAN, capKm: 500 },
    );
    const owners = ownersIn(rows, 1955);
    expect(owners.get("48001")).toBe("houston");
    expect(owners.get("48002")).toBe("houston");
  });

  it("splits a shared state by which market is nearer", () => {
    const rows = assignCounties(
      [terr("houston", ["TX"]), terr("austin", ["TX"])],
      [market("houston", HOUSTON), market("austin", AUSTIN)],
      [NEAR_AUSTIN, NEAR_HOUSTON],
      { ...SPAN, capKm: 500 },
    );
    const owners = ownersIn(rows, 1955);
    // Each county goes to the office whose town it sits next to, even though
    // both promotions claim the whole state.
    expect(owners.get("48001")).toBe("austin");
    expect(owners.get("48002")).toBe("houston");
  });

  it("leaves a county unowned when every market is beyond the cap", () => {
    // El Paso is about 800 km from Austin, so a 320 km cap cannot reach it.
    expect(haversineKm(AUSTIN[0], AUSTIN[1], EL_PASO[0], EL_PASO[1])).toBeGreaterThan(700);

    const rows = assignCounties(
      [terr("austin", ["TX"])],
      [market("austin", AUSTIN)],
      [NEAR_AUSTIN, NEAR_EL_PASO],
      { ...SPAN, capKm: 320 },
    );
    const owners = ownersIn(rows, 1955);
    expect(owners.get("48001")).toBe("austin");
    expect(owners.has("48003")).toBe(false);

    // Without a cap the same office swallows it, which is the behaviour the cap
    // exists to prevent: one town claiming ground nobody was near.
    const uncapped = assignCounties(
      [terr("austin", ["TX"])],
      [market("austin", AUSTIN)],
      [NEAR_AUSTIN, NEAR_EL_PASO],
      { ...SPAN, capKm: null },
    );
    expect(ownersIn(uncapped, 1955).get("48003")).toBe("austin");
  });

  it("ignores a county whose state no active promotion claims", () => {
    const CA = unit("06001", -122.4, 37.8);
    const rows = assignCounties(
      [terr("houston", ["TX"])],
      [market("houston", HOUSTON)],
      [NEAR_HOUSTON, CA],
      { ...SPAN, capKm: 500 },
    );
    expect(ownersIn(rows, 1955).has("06001")).toBe(false);
  });

  it("skips a promotion with no state footprint, however many towns it has", () => {
    const rows = assignCounties(
      [terr("stampede", [])],
      [market("stampede", HOUSTON)],
      [NEAR_HOUSTON],
      { ...SPAN, capKm: 500 },
    );
    expect(rows).toHaveLength(0);
  });

  it("collapses a stable owner into one run rather than one row per year", () => {
    const rows = assignCounties(
      [terr("houston", ["TX"], 1950, 1960)],
      [market("houston", HOUSTON, 1950, 1960)],
      [NEAR_HOUSTON],
      { ...SPAN, capKm: 500 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fips: "48002", fromYear: 1950, toYear: 1960 });
  });

  it("cuts a new run when the county changes hands mid-span", () => {
    const rows = assignCounties(
      [terr("first", ["TX"], 1950, 1954), terr("second", ["TX"], 1955, 1960)],
      [market("first", HOUSTON, 1950, 1954), market("second", HOUSTON, 1955, 1960)],
      [NEAR_HOUSTON],
      { ...SPAN, capKm: 500 },
    );
    const forCounty = rows.filter((r) => r.fips === "48002");
    expect(forCounty).toHaveLength(2);
    expect(forCounty[0]).toMatchObject({ territoryId: "first", fromYear: 1950, toYear: 1954 });
    expect(forCounty[1]).toMatchObject({ territoryId: "second", fromYear: 1955, toYear: 1960 });
  });

  it("respects a market's own years, not just the promotion's", () => {
    // The office runs the whole span but only reaches this town late.
    const rows = assignCounties(
      [terr("austin", ["TX"], 1950, 1960)],
      [market("austin", AUSTIN, 1957, 1960)],
      [NEAR_AUSTIN],
      { ...SPAN, capKm: 320 },
    );
    expect(ownersIn(rows, 1955).has("48001")).toBe(false);
    expect(ownersIn(rows, 1958).get("48001")).toBe("austin");
  });
});
