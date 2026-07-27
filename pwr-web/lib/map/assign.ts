/**
 * County ownership, derived. Nobody authors a border.
 *
 * Each unit goes to the active promotion that (a) lists the unit's state in its
 * footprint for that year and (b) has the nearest market, inside a distance cap.
 * Single-promotion states fill solid; shared states split by proximity.
 *
 * The state mask is what keeps this cheap. A county only ever compares the
 * promotions that claim its state, so the candidate set stays at two or three
 * however many promotions exist in total.
 *
 * The cap is the honest half. Without it a promotion with one sourced town
 * inherits every county in every state it lists, so a thinly researched office
 * draws exactly as confidently as a well researched one. With it, ground nobody
 * had a town near stays blank, which is the truthful reading.
 *
 * Ported from territory_maps/scripts/build-nwa.mjs, which ran this at build
 * time and wrote assignments.json. Here it runs per request behind a cache, so
 * a market run entered in the app moves the border on the next load.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BaseGeography, CountyAssignment } from "./config";

/** A promoter's out-and-back radius. Tuning knob; nothing stores it. */
export const DEFAULT_CAP_KM = 320;

/** US FIPS state prefix to postal code, so a unit can be masked by state. */
const FIPS2_POSTAL: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};

/**
 * Full state name to postal code, for the layers that carry a name rather than
 * a FIPS prefix. na-admin2's non-US units carry the literal "Canada" or
 * "Mexico" with no province or state code, so those units cannot be masked and
 * are skipped until the layer is rebuilt against StatCan census divisions and
 * Mexican municipios that carry their codes.
 */
const NAME_TO_POSTAL: Record<string, string> = Object.fromEntries(
  Object.entries({
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
    California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
    "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI",
    Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
    Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
    Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
    Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Puerto Rico": "PR",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
    Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  }),
);

export type AssignTerritory = {
  id: string;
  states: string[];
  startYear: number;
  endYear: number;
};

export type AssignMarket = {
  territoryId: string;
  lon: number;
  lat: number;
  fromYear: number;
  toYear: number;
};

export type Unit = { fips: string; postal: string | null; lon: number; lat: number };

export function haversineKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Ring = number[][];
type Geom =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

function centroid(geometry: Geom): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const addRing = (ring: Ring) => {
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
      n++;
    }
  };
  if (geometry.type === "Polygon") for (const r of geometry.coordinates) addRing(r);
  else for (const p of geometry.coordinates) for (const r of p) addRing(r);
  return n ? [sx / n, sy / n] : null;
}

/**
 * Parsing 2.5 MB of GeoJSON and reducing it to centroids is one-time work, so
 * it is held here rather than repeated per request. A warm server pays it once.
 */
const unitCache = new Map<BaseGeography, Promise<Unit[]>>();

export function loadUnits(geography: BaseGeography): Promise<Unit[]> {
  const cached = unitCache.get(geography);
  if (cached) return cached;

  const task = (async () => {
    const file = path.join(process.cwd(), "public", "geo", `${geography}.geojson`);
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      features: Array<{ properties: { fips: string; state?: string }; geometry: Geom }>;
    };
    const units: Unit[] = [];
    for (const f of raw.features) {
      const c = centroid(f.geometry);
      if (!c) continue;
      const fips = f.properties.fips;
      // Prefer the FIPS prefix; fall back to the state name for layers that
      // carry one. Non-US na-admin2 units resolve to null and are skipped.
      const postal =
        FIPS2_POSTAL[fips.slice(0, 2)] ??
        (f.properties.state ? (NAME_TO_POSTAL[f.properties.state] ?? null) : null);
      units.push({ fips, postal, lon: c[0], lat: c[1] });
    }
    return units;
  })();

  unitCache.set(geography, task);
  return task;
}

/**
 * Sweep every year and collapse each unit's per-year owner into
 * {fips, territoryId, fromYear, toYear} runs, which is what the renderer wants
 * and is roughly seventy times smaller than one row per unit per year.
 */
export function assignCounties(
  territories: AssignTerritory[],
  markets: AssignMarket[],
  units: Unit[],
  opts: { startYear: number; endYear: number; capKm?: number | null },
): CountyAssignment[] {
  const cap = opts.capKm === undefined ? DEFAULT_CAP_KM : opts.capKm;

  // Only promotions with a state footprint can win a fill. One with markets but
  // no footprint still draws its markers.
  const drawable = territories.filter((t) => t.states.length > 0);

  const marketsByTerr = new Map<string, AssignMarket[]>();
  for (const m of markets) {
    const list = marketsByTerr.get(m.territoryId);
    if (list) list.push(m);
    else marketsByTerr.set(m.territoryId, [m]);
  }

  // Bucket units by state so a year's candidates are found without rescanning.
  const unitsByState = new Map<string, Unit[]>();
  for (const u of units) {
    if (!u.postal) continue;
    const list = unitsByState.get(u.postal);
    if (list) list.push(u);
    else unitsByState.set(u.postal, [u]);
  }

  const timeline = new Map<string, Map<number, string>>();

  for (let year = opts.startYear; year <= opts.endYear; year++) {
    const active = drawable.filter((t) => year >= t.startYear && year <= t.endYear);
    if (active.length === 0) continue;

    // state -> the promotions claiming it this year
    const claimants = new Map<string, AssignTerritory[]>();
    for (const t of active) {
      for (const s of t.states) {
        const list = claimants.get(s);
        if (list) list.push(t);
        else claimants.set(s, [t]);
      }
    }

    for (const [state, candidates] of claimants) {
      for (const u of unitsByState.get(state) ?? []) {
        let best: string | null = null;
        let bestD = Number.POSITIVE_INFINITY;
        for (const t of candidates) {
          for (const m of marketsByTerr.get(t.id) ?? []) {
            if (year < m.fromYear || year > m.toYear) continue;
            const d = haversineKm(u.lon, u.lat, m.lon, m.lat);
            // Ties break on territory id so a rerun gives the same map.
            if (d < bestD || (d === bestD && best !== null && t.id < best)) {
              bestD = d;
              best = t.id;
            }
          }
        }
        if (best === null) continue;
        if (cap !== null && bestD > cap) continue;
        let byYear = timeline.get(u.fips);
        if (!byYear) {
          byYear = new Map();
          timeline.set(u.fips, byYear);
        }
        byYear.set(year, best);
      }
    }
  }

  const out: CountyAssignment[] = [];
  for (const [fips, byYear] of timeline) {
    let run: CountyAssignment | null = null;
    for (let year = opts.startYear; year <= opts.endYear; year++) {
      const owner = byYear.get(year);
      if (run && owner === run.territoryId && year === run.toYear + 1) {
        run.toYear = year;
        continue;
      }
      if (run) out.push(run);
      run = owner ? { fips, territoryId: owner, fromYear: year, toYear: year } : null;
    }
    if (run) out.push(run);
  }
  out.sort((a, b) => a.fips.localeCompare(b.fips) || a.fromYear - b.fromYear);
  return out;
}
