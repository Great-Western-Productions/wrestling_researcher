/**
 * Visual themes. The renderer stays styleless (no external tiles); a theme is
 * just the handful of colors/weights that make the base look like a paper
 * atlas rather than a web map.
 */
export interface MapTheme {
  /** Page + map background (the "paper"). */
  paper: string;
  /** Country / state-province outlines. */
  stateOutline: string;
  stateOutlineWidth: number;
  /** Thin internal county hairlines drawn under the fills. */
  countyOutline: string;
  countyOutlineWidth: number;
  /** Dissolved territory borders (drawn over the fills). */
  territoryOutline: string;
  territoryOutlineWidth: number;
  /** Opacity of the Tier-1 territory fill. */
  fillOpacity: number;
  /** Fill for counties with no owner in the current year. */
  unassignedFill: string;
  /** Fill for owned-but-not-highlighted counties in highlight mode. */
  dimFill: string;
  /** Marker stroke + label colors. */
  markerStroke: string;
  labelColor: string;
  labelHalo: string;
}

export const THEMES: Record<string, MapTheme> = {
  atlas: {
    paper: '#efe7d3',
    stateOutline: '#6b5d47',
    stateOutlineWidth: 1.1,
    countyOutline: '#d8cbb0',
    countyOutlineWidth: 0.4,
    territoryOutline: '#3a2f1d',
    territoryOutlineWidth: 1.6,
    fillOpacity: 0.72,
    unassignedFill: '#e4dbc4',
    dimFill: '#cdc4ab',
    markerStroke: '#2a2213',
    labelColor: '#2a2213',
    labelHalo: '#efe7d3',
  },
  /**
   * The archive's own palette, so the map reads as part of the site rather
   * than an embed from somewhere else. Values are pwr-web's tokens from
   * public/style.css: --paper, --burgundy, --border, --ink, --paper-warm.
   */
  pwr: {
    paper: '#f8f4e6',
    stateOutline: '#5a1f2e',
    stateOutlineWidth: 1.1,
    countyOutline: '#d1cdc0',
    countyOutlineWidth: 0.4,
    territoryOutline: '#1a1a1a',
    territoryOutlineWidth: 1.6,
    fillOpacity: 0.72,
    unassignedFill: '#f1ebd6',
    dimFill: '#d1cdc0',
    markerStroke: '#1a1a1a',
    labelColor: '#1a1a1a',
    labelHalo: '#f8f4e6',
  },
  // A cooler, higher-contrast variant for the interactive GWA map.
  slate: {
    paper: '#f3f1ec',
    stateOutline: '#5a5f6a',
    stateOutlineWidth: 1.1,
    countyOutline: '#dcdad3',
    countyOutlineWidth: 0.4,
    territoryOutline: '#2b2f36',
    territoryOutlineWidth: 1.5,
    fillOpacity: 0.7,
    unassignedFill: '#e6e4dd',
    dimFill: '#d5d2c8',
    markerStroke: '#1c1f24',
    labelColor: '#1c1f24',
    labelHalo: '#f3f1ec',
  },
};

export function resolveTheme(key: string): MapTheme {
  return THEMES[key] ?? THEMES.atlas;
}
