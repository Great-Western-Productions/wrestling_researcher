"use client";

/**
 * The client boundary for the map.
 *
 * MapLibre touches `window` on construction, so the renderer cannot be server
 * rendered. In this version of Next `ssr: false` is honoured only inside a
 * Client Component, so the `dynamic()` call has to live here rather than in
 * app/map/page.tsx. Putting it in the page builds fine and then fails at
 * runtime, which is the one trap in this whole port.
 */

import dynamic from "next/dynamic";
import type { MapConfig, TerritoryMapData } from "@/lib/map/config";

const TerritoryMap = dynamic(() => import("./TerritoryMap"), {
  ssr: false,
  loading: () => (
    <div className="map-placeholder" role="status" aria-live="polite">
      Drawing the territories…
    </div>
  ),
});

export function MapMount({
  hrefBase,
  ...props
}: {
  config: MapConfig;
  data: TerritoryMapData;
  height?: string;
  initialYear?: number;
  /** Focus one promotion and grey out the rest. */
  highlightId?: string | null;
  /** Drop the legend and year control, for an illustration rather than a tool. */
  bare?: boolean;
  /**
   * Prefix for a promotion's own page, e.g. "/territory/". A string rather than
   * a callback because props from a Server Component have to be serialisable,
   * and the renderer still takes a function so it stays usable on its own.
   */
  hrefBase?: string;
}) {
  return <TerritoryMap {...props} hrefFor={hrefBase ? (id) => `${hrefBase}${id}` : undefined} />;
}

export default MapMount;
