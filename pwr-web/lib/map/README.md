# The territory map

`/map` draws the North American wrestling territories year by year, 1925 to
1995, from the live database. `/territory/[id]` shows one promotion's turf on
its own record page.

The published map at `maps.gwawrestling.com/territorial-era` rebuilds a JSON
artifact with a script and ships it. This one queries Postgres on request, so a
market run entered in the app moves a border on the next page load. That
freshness is the reason the map lives inside the archive rather than beside it.

## Where things are

| Path | What |
| --- | --- |
| `app/map/page.tsx` | The page. Server Component, queries and renders. |
| `components/map/MapMount.tsx` | The client boundary. `dynamic(..., { ssr: false })` lives here. |
| `components/map/TerritoryMap.tsx` | The renderer, ported from `territory_maps`. |
| `components/map/TerritoryFootprint.tsx` | One promotion's turf, for its record page. |
| `lib/queries/map.ts` | The three queries: territories with eras, markets, runs. |
| `lib/map/assign.ts` | County ownership, derived. |
| `lib/map/build.ts` | Rows to renderer types, behind the cache. |
| `lib/map/config.ts` | `Territory`, `Market`, `MarketTenure`, `CountyAssignment`. |
| `public/geo/*.geojson` | Committed base geometry, 3.5 MB. Not generated at runtime. |

## How a border gets drawn

Nobody authors a border. Each county goes to the active promotion that lists
the county's state in its footprint for that year and has the nearest market,
inside a 320 km cap. Single-promotion states fill solid; shared states split by
proximity.

Two halves matter and they do different jobs.

**The state mask** decides who wins a contest. It is also what keeps the sweep
cheap: a county only ever compares the promotions claiming its state, so the
candidate set stays at two or three however many promotions exist.

**The distance cap** decides whether the far edges are owned at all. Without it
a promotion with one sourced town inherits every county in every state it
lists, so a thinly researched office draws exactly as confidently as a well
researched one. With it, ground nobody had a town near stays blank, which reads
honestly as "no office we have a record of ran here."

`DEFAULT_CAP_KM` in `assign.ts` is the knob. Nothing stores it.

## What keeps a row off the map

`territories.map_color`. A null colour excludes the row entirely, which is how
the sanctioning bodies and joint ventures stay off it: the National Wrestling
Alliance sanctioned a world champion and never ran a card, so it has no turf.

An era at `low` confidence is also dropped from the fill path. A footprint that
rests on nothing is a border invented out of thin air. Those promotions still
reach the map through their markets and draw as markers.

## Caching

`buildMapData` is wrapped in `unstable_cache` tagged `MAP_CACHE_TAG`. Cold cost
is the geometry parse plus the sweep, under a second at full corpus scale; warm
is a memory read. The geometry parse and centroid pass are held in module scope,
so a warm server pays them once.

Anything that writes a territory, era, market or run must invalidate the tag.
`createTerritoryAction` uses `updateTag(MAP_CACHE_TAG)` rather than
`revalidateTag`, because it is a Server Action and the person who just entered
the row should see it on the map, not the previous version once more.

## Two traps

**`ssr: false` has to live in a Client Component.** In this version of Next it
is honoured only there, so the `dynamic()` call is in `MapMount.tsx` and not in
`app/map/page.tsx`. Putting it in the page builds fine and fails at runtime.

**Props from a Server Component must be serialisable.** That is why the page
passes `hrefBase="/territory/"` as a string and `MapMount` turns it into the
`hrefFor` callback the renderer wants. Passing the function directly throws
"Functions cannot be passed directly to Client Components".

## Verifying a change

The map does not render inside Claude's in-app browser: MapLibre's worker never
starts there, so the canvas stays blank while the legend and controls draw
normally. The published site fails identically in it, so that is the sandbox
rather than the code. Check it in a real browser.

Better, and what the tests do: verify headlessly. `tests/integration/queries/map.test.ts`
drives the whole pipeline against a Testcontainers Postgres and asserts a
specific county's owner in a specific year. `tests/unit/assign.test.ts` covers
the sweep itself.

To check the port against the published map, pull the assignment rows out of
the page payload and diff them by crosswalk:

```bash
curl -s http://localhost:3000/map -o /tmp/mappage.html
```

Then match `{"fips","territoryId","fromYear","toYear"}` against
`territory_maps` `main:src/data/nwa/assignments.json`. As of the port this sits
at 96 to 98 percent agreement across 1958, 1965, 1975 and 1985, with three
intended differences: the cap keeps Kansas City out of eastern Missouri,
Virginia left the WWF footprint for having no town behind it, and Malcewicz's
earlier San Francisco era contests California.

## Canada and Mexico

`na-admin2.geojson` carries the literal string `"Canada"` or `"Mexico"` as the
state of every non-US unit, with no province or Mexican state code, so those
units cannot be masked and are skipped. Canadian and Mexican eras still record
their real footprints (`{ON}`, `{CMX,MEX}`) so nothing has to be redone when the
layer is rebuilt against StatCan census divisions and Mexican municipios.
