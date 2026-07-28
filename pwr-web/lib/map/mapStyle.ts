/**
 * Styleless MapLibre base + data-driven layer builders.
 *
 * No external tiles, no glyphs, no sprite: the base is a solid "paper"
 * background plus self-hosted GeoJSON layers (county fills, county hairlines,
 * state/country outlines, and an optional contested hatch). Text labels and
 * split market markers are drawn as HTML overlays by the React island, which
 * is why the style needs no glyph server and stays fully self-contained.
 */
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { BaseGeography, MapConfig, Territory } from "./config";
import type { MapTheme } from "./theme";

export const SRC = {
  counties: "counties",
  states: "states",
  contested: "contested",
} as const;

export const LYR = {
  background: "bg",
  countyFill: "county-fill",
  countyLine: "county-line",
  stateLine: "state-line",
  contestedFill: "contested-fill",
} as const;

/** Property name carrying the zero-padded 5-char county FIPS. */
export const FIPS_PROP = "fips";

const DEFAULT_GEO_URLS: Record<BaseGeography, string> = {
  "us-counties": "/geo/us-counties.geojson",
  "na-admin2": "/geo/na-admin2.geojson",
  "na-states": "/geo/na-states.geojson",
};

export function geoUrl(config: MapConfig, geo: BaseGeography): string {
  return config.geoUrls?.[geo] ?? DEFAULT_GEO_URLS[geo];
}

/**
 * Tier-1 fill color as a MapLibre `match` expression on the FIPS property.
 * Rebuilt whenever the year changes; paired with a `fill-color-transition`
 * so year-to-year ownership changes crossfade instead of snapping.
 */
export function countyFillColor(
  ownership: Map<string, string>,
  territories: Territory[],
  theme: MapTheme,
  highlightId?: string | null,
): ExpressionSpecification | string {
  const colorOf = new Map(territories.map((t) => [t.id, t.color]));
  const pairs: string[] = [];
  for (const [fips, territoryId] of ownership) {
    // Highlight mode: everyone but the focused territory greys out.
    const color =
      highlightId && territoryId !== highlightId ? theme.dimFill : colorOf.get(territoryId);
    if (color) pairs.push(fips, color);
  }
  if (pairs.length === 0) return theme.unassignedFill;
  return [
    "match",
    ["get", FIPS_PROP],
    ...pairs,
    theme.unassignedFill,
  ] as unknown as ExpressionSpecification;
}

/** The base style: paper background + empty-until-loaded county/state sources. */
export function buildBaseStyle(config: MapConfig, theme: MapTheme): StyleSpecification {
  const countyFill: FillLayerSpecification = {
    id: LYR.countyFill,
    type: "fill",
    source: SRC.counties,
    paint: {
      "fill-color": theme.unassignedFill,
      "fill-opacity": theme.fillOpacity,
      // Crossfade ownership changes when the year advances.
      "fill-color-transition": { duration: 350, delay: 0 },
    },
  };

  const countyLine: LineLayerSpecification = {
    id: LYR.countyLine,
    type: "line",
    source: SRC.counties,
    paint: {
      "line-color": theme.countyOutline,
      "line-width": theme.countyOutlineWidth,
    },
  };

  const stateLine: LineLayerSpecification = {
    id: LYR.stateLine,
    type: "line",
    source: SRC.states,
    paint: {
      "line-color": theme.stateOutline,
      "line-width": theme.stateOutlineWidth,
    },
  };

  // The fill layer draws whichever admin-2 geography the config asked for.
  const admin2: BaseGeography = config.baseGeography === "na-admin2" ? "na-admin2" : "us-counties";

  const sources: StyleSpecification["sources"] = {
    [SRC.counties]: {
      type: "geojson",
      data: geoUrl(config, admin2),
      promoteId: FIPS_PROP,
    },
    [SRC.states]: {
      type: "geojson",
      data: geoUrl(config, "na-states"),
    },
  };

  const layers: StyleSpecification["layers"] = [
    {
      id: LYR.background,
      type: "background",
      paint: { "background-color": theme.paper },
    },
  ];

  // The county fill/line only make sense when counties are the base geography,
  // but loading the county source is harmless for na-states maps too. We keep
  // the fill for both since territories are always county-assigned here.
  layers.push(countyFill, countyLine, stateLine);

  return {
    version: 8,
    name: `atlas:${config.id}`,
    // No glyphs/sprite on purpose — labels are HTML overlays.
    sources,
    layers,
  };
}

/**
 * A diagonal-stripe image for Tier-3 contested overlays (MapLibre
 * `fill-pattern`). Browser-only (uses a canvas); call after map load.
 */
export function hatchPattern(
  color: string,
  size = 8,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.moveTo(-size / 2, size / 2);
  ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(size / 2, size * 1.5);
  ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: img.data };
}
