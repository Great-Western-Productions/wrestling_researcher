import { MapMount } from "@/components/map/MapMount";
import { buildMapData, MAP_END_YEAR, MAP_START_YEAR } from "@/lib/map/build";
import type { MapConfig } from "@/lib/map/config";

/**
 * One promotion's turf, on its own record page.
 *
 * Reuses the shared renderer with the highlight it already supports: this
 * promotion keeps its colour, everyone else greys out, and the legend and year
 * control are hidden so the map reads as an illustration rather than a second
 * place to go exploring. The year still moves through the slider on /map.
 *
 * Renders nothing at all when the promotion has no turf to show, which is the
 * common case for the 272 modern independents and for anything not yet
 * researched. A grey rectangle would be worse than no rectangle.
 */
export async function TerritoryFootprint({
  territoryId,
  name,
}: {
  territoryId: number;
  name: string;
}) {
  const data = await buildMapData();
  const id = String(territoryId);

  const territory = data.territories.find((t) => t.id === id);
  if (!territory) return null;

  const owns = data.assignments.some((a) => a.territoryId === id);
  const towns = data.markets.filter((m) => m.territoryIds.includes(id));
  if (!owns && towns.length === 0) return null;

  // Open on a year this promotion was actually running, otherwise the map
  // opens on 1925 and shows the reader an empty continent.
  const midpoint = Math.round((territory.startYear + territory.endYear) / 2);

  const config: MapConfig = {
    id: `territory-${id}`,
    title: name,
    baseGeography: "us-counties",
    center: [-97, 39],
    zoom: 3,
    years: { start: MAP_START_YEAR, end: MAP_END_YEAR },
    theme: "pwr",
    overlays: ["markets"],
  };

  return (
    <section className="territory-footprint">
      <h2>Territory</h2>
      <p className="subtitle">
        {territory.startYear}–{territory.endYear}, shown in {midpoint}.{" "}
        {towns.length > 0 ? (
          <>
            {towns.length} town{towns.length === 1 ? "" : "s"} on record.{" "}
          </>
        ) : null}
        <a href={`/map?year=${midpoint}&highlight=${id}`}>Open on the full map</a>
      </p>
      <MapMount
        config={config}
        data={data}
        height="42vh"
        initialYear={midpoint}
        highlightId={id}
        bare
      />
    </section>
  );
}

export default TerritoryFootprint;
