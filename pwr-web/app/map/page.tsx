import type { Metadata } from "next";
import Link from "next/link";
import { MapMount } from "@/components/map/MapMount";
import type { MapConfig } from "@/lib/map/config";
import { buildMapData, MAP_END_YEAR, MAP_START_YEAR } from "@/lib/map/build";

// Reads live rows, same as the other pages. The expensive part (the geometry
// parse and the assignment sweep) is held by unstable_cache, not by the route.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Territory map — Pro Wrestling Data Archive",
  description:
    "The North American wrestling territories year by year, 1925 to 1995, drawn from the archive's own records.",
};

const CONFIG: MapConfig = {
  id: "territorial-era",
  title: "Territorial Era",
  subtitle: "North American promotions, 1925–1995",
  baseGeography: "us-counties",
  center: [-97, 39],
  zoom: 3.4,
  years: { start: MAP_START_YEAR, end: MAP_END_YEAR },
  theme: "pwr",
  overlays: ["markets"],
};

export default async function MapPage() {
  const data = await buildMapData();

  const drawable = data.territories.length;
  const withFill = new Set(data.assignments.map((a) => a.territoryId)).size;
  const markersOnly = drawable - withFill;

  return (
    <>
      <nav className="breadcrumbs">
        <Link href="/">Home</Link> <span aria-hidden="true">›</span> <span>Map</span>
      </nav>

      <h1>Territory map</h1>
      <p className="subtitle">
        The North American territories year by year, {MAP_START_YEAR} to {MAP_END_YEAR}. Every
        border here is a consequence of which towns are on record, so the map moves as the
        archive fills in.
      </p>

      {drawable === 0 ? (
        <p className="empty-note">
          No promotion has an era and a colour yet, so there is nothing to draw. Add a territory
          era and a few market runs and this page will show them.
        </p>
      ) : (
        <MapMount config={CONFIG} data={data} height="72vh" hrefBase="/territory/" />
      )}

      <p className="map-coverage">
        {drawable} promotion{drawable === 1 ? "" : "s"} on the map, {withFill} with enough towns to
        claim ground
        {markersOnly > 0 ? `, ${markersOnly} drawn as markers only` : ""}. Blank ground means no
        office we have a record of ran there, rather than that nobody did.
      </p>

      <p className="map-accuracy">
        <strong>A note on accuracy:</strong> these borders are derived from the towns each
        promotion is recorded as running, so some are certainly wrong or incomplete. Corrections
        belong in the record itself.
      </p>
    </>
  );
}
