"use client";

import type { Map as MlMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
/**
 * Tier-2 market overlay. Manages one MapLibre Marker per active market
 * (imperatively — markers are DOM, not GL layers) and redraws them as split
 * discs when a city has more than one owning territory in the current year.
 * Renders no React output of its own.
 */
import { useEffect, useRef } from "react";
import type { Market, Territory } from "@/lib/map/config";
import { radiusForTier, splitMarkerSvg } from "@/lib/map/splitMarker";
import type { MapTheme } from "@/lib/map/theme";

export interface MarkerLayerProps {
  map: MlMap | null;
  markets: Market[];
  territories: Territory[];
  theme: MapTheme;
  onSelect?: (market: Market) => void;
}

export default function MarkerLayer({
  map,
  markets,
  territories,
  theme,
  onSelect,
}: MarkerLayerProps) {
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!map) return;
    const colorOf = new Map(territories.map((t) => [t.id, t.color]));

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const market of markets) {
      const colors = market.territoryIds
        .map((id) => colorOf.get(id))
        .filter((c): c is string => Boolean(c));
      if (colors.length === 0) continue;

      const el = document.createElement("div");
      el.className = "tm-marker";
      el.style.cursor = onSelect ? "pointer" : "default";
      el.innerHTML = splitMarkerSvg(colors, {
        radius: radiusForTier(market.tier),
        stroke: theme.markerStroke,
      });
      const owners = market.territoryIds
        .map((id) => territories.find((t) => t.id === id)?.name ?? id)
        .join(", ");
      el.title = `${market.name} — ${owners}`;
      el.setAttribute("data-market", market.id);
      el.setAttribute("aria-label", el.title);

      if (onSelect) {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect(market);
        });
      }

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([market.lon, market.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [map, markets, territories, theme, onSelect]);

  return null;
}
