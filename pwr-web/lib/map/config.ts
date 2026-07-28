/**
 * Core data model for the territory-map framework.
 *
 * Everything is keyed by time: county ownership, market ownership, and
 * contested regions all change year to year, so `year` is a first-class
 * input to the renderer and most records carry a [from, to] lifespan.
 *
 * Nothing in this file is GWA- or NWA-specific. A new map is a data folder
 * (territories + assignments + markets [+ contested]) plus a page that
 * instantiates <TerritoryMap config={...} data={...} />.
 */
import type { MultiPolygon, Polygon } from "geojson";

/**
 * A stretch during which a promotion held one identity and one footprint.
 *
 * A promotion is rarely one thing for its whole life: it changes hands, it is
 * renamed, it gains or loses a state. Carrying the eras lets the detail panel
 * answer "who held this in 1963" rather than showing the same summary at every
 * point on the slider.
 */
export interface TerritoryEra {
  fromYear: number;
  toYear: number;
  promotionName?: string;
  promoter?: string;
  states?: string[];
  nwaMember?: boolean;
}

/** A promotion / territory. `color` drives the Tier-1 county fill. */
export interface Territory {
  id: string;
  name: string;
  /** Any CSS color MapLibre accepts (hex preferred). */
  color: string;
  startYear: number;
  endYear: number;
  /** Optional, ordered. The panel shows the one covering the current year. */
  eras?: TerritoryEra[];
  /** Free-form: company, hub city, style, booking philosophy, links, etc. */
  meta?: Record<string, unknown>;
}

/**
 * Tier 1 — core turf. Each county belongs to at most one territory in any
 * given year. A county can change hands over time, so ownership carries a
 * [fromYear, toYear] window; overlapping windows for the same fips are a
 * data error the loader should surface.
 */
export interface CountyAssignment {
  /** 5-digit county FIPS (state + county), zero-padded. */
  fips: string;
  territoryId: string;
  fromYear: number;
  toYear: number;
}

export type MarketTier = "Primary" | "Secondary" | "Tertiary";

/**
 * Tier 2 — shared markets. Rendered as point markers. When `territoryIds`
 * has more than one entry active in a given year, the marker is drawn split
 * (pie wedges / concentric rings), one slice per owning territory. This is
 * where overlap lives, so it never muddies the Tier-1 fill.
 */
export interface Market {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** One or more owning territories. >1 (active) ⇒ split marker. */
  territoryIds: string[];
  tier?: MarketTier;
  startYear: number;
  endYear: number;
  /** Free-form: state/region, country, population, border flag, links. */
  meta?: Record<string, unknown>;
}

/**
 * Time-varying market ownership. Where a source can say "in these years,
 * territory T ran market M at this tier" (the GWA Territory-Year Snapshots),
 * tenures carry it and override the static `Market.territoryIds` / lifespan.
 * Markets with no tenure rows fall back to their static fields, so a partly
 * authored dataset renders correctly.
 */
export interface MarketTenure {
  marketId: string;
  territoryId: string;
  fromYear: number;
  toYear: number;
  tier?: MarketTier;
}

/**
 * Tier 3 — contested regions. Optional, always hand-authored, never
 * auto-generated. A whole region that was co-promoted or fought over,
 * drawn as a hatched overlay on top of the fill.
 */
export interface ContestedZone {
  id: string;
  geometry: Polygon | MultiPolygon;
  territoryIds: string[];
  fromYear: number;
  toYear: number;
  label?: string;
}

/** The full data bundle a single map renders from. */
export interface TerritoryMapData {
  territories: Territory[];
  assignments: CountyAssignment[];
  markets: Market[];
  contested?: ContestedZone[];
  /** Optional per-year market ownership; wins over Market's static fields. */
  tenures?: MarketTenure[];
}

/**
 * `us-counties` US counties only. `na-admin2` adds Canadian census divisions
 * and Mexican municipios, so cross-border territories get a real fill.
 * `na-states` is the country/province outline drawn behind both.
 */
export type BaseGeography = "us-counties" | "na-admin2" | "na-states";

/** `{start,end}` ⇒ interactive slider; `number[]` ⇒ fixed snapshots. */
export type YearSpec = { start: number; end: number } | number[];

export type OverlayKind = "markets" | "contested";

export interface MapConfig {
  id: string;
  title: string;
  subtitle?: string;
  baseGeography: BaseGeography;
  center: [number, number];
  zoom: number;
  /** Optional clamp to keep the viewport over the mapped region. */
  bounds?: [[number, number], [number, number]];
  years: YearSpec;
  /** Visual theme key resolved in lib/theme.ts. */
  theme: string;
  overlays?: OverlayKind[];
  /** Where the base geometry lives, under public/. Defaults per geography. */
  geoUrls?: Partial<Record<BaseGeography, string>>;
}

/** True when the config drives an interactive year slider. */
export function isYearRange(years: YearSpec): years is { start: number; end: number } {
  return !Array.isArray(years);
}

/** Ordered list of years this map can display. */
export function yearList(years: YearSpec): number[] {
  if (isYearRange(years)) {
    const out: number[] = [];
    for (let y = years.start; y <= years.end; y++) out.push(y);
    return out;
  }
  return [...years].sort((a, b) => a - b);
}

/** First / last displayable year, regardless of spec shape. */
export function yearExtent(years: YearSpec): [number, number] {
  const list = yearList(years);
  return [list[0], list[list.length - 1]];
}
