'use client';

/**
 * The one config-driven MapLibre renderer. Takes (config, data) and a year,
 * and paints:
 *   Tier 1  county choropleth by as-of-year owner   (GL fill layer)
 *   Tier 2  market markers, split when co-owned      (MarkerLayer, HTML)
 *   Tier 3  contested regions as a hatch overlay      (GL fill-pattern)
 * plus year controls, a legend, and a click-to-detail panel.
 *
 * The same component backs all three surfaces: a fixed year = a static
 * snapshot, a year range = the interactive slider, and the headless video
 * exporter drives it through window.__setYear.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './territory-map.css';

import type { MapConfig, Market, Territory, TerritoryMapData } from '@/lib/map/config';
import { isYearRange, yearExtent, yearList } from '@/lib/map/config';
import { frameFor } from '@/lib/map/timeFilter';
import { resolveTheme } from '@/lib/map/theme';
import {
  LYR,
  SRC,
  buildBaseStyle,
  countyFillColor,
  hatchPattern,
} from '@/lib/map/mapStyle';
import MarkerLayer from './MarkerLayer';
import MapLegend from './MapLegend';
import YearControls from './YearControls';

const HATCH_IMAGE = 'tm-hatch';
const CONTESTED_LAYER = 'contested-fill';
/** Breathing room around `config.bounds`, in px, on every fit. */
const FIT_PADDING = 24;

/* Thresholds for collapsing the legend, measured off the map's own box rather
   than the viewport, because an embed is sized by whatever iframe holds it.
   Both are absolute px, not a share of the box: the legend's own size is fixed,
   so a ratio against the container reads as "many territories" on a laptop the
   same as it does on a phone, and 1280x720 is a laptop. */
/** At 520px the legend is 42% of the map's width and covers what it labels. */
const LEGEND_COMPACT_WIDTH = 520;
/** Shorter than any desktop map (76vh), which catches landscape phones. */
const LEGEND_COMPACT_HEIGHT = 360;

/** How long to wait for MapLibre to go idle before revealing the map anyway. */
const PAINT_TIMEOUT_MS = 12_000;

/**
 * True on a touch-primary device. `pointer: coarse` is the pointer the device
 * leads with, so a phone and a tablet match while a laptop with a touchscreen
 * does not.
 */
function prefersCooperativeGestures(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export interface TerritoryMapProps {
  config: MapConfig;
  data: TerritoryMapData;
  initialYear?: number;
  height?: string;
  /**
   * Where a promotion's own record lives, if it has one. Supplied by the host
   * app so the renderer stays free of any router import and still works as a
   * standalone map when nothing is passed.
   */
  hrefFor?: (territoryId: string) => string;
}

function initialYearFor(config: MapConfig, initialYear?: number): number {
  const [start, end] = yearExtent(config.years);

  // A range map accepts any year inside its bounds. A snapshot map only has
  // the years its selector offers, so anything else (?year=1970 against
  // [1958, 1965, 1975, 1985]) would paint a frame the controls can't show as
  // active and the reader can't navigate back to.
  const displayable = (y: number) => {
    if (!Number.isFinite(y)) return false;
    if (isYearRange(config.years)) return y >= start && y <= end;
    return yearList(config.years).includes(y);
  };

  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search).get('year');
    if (p) {
      const y = Number(p);
      if (displayable(y)) return y;
    }
  }
  if (initialYear != null && displayable(initialYear)) return initialYear;
  return start;
}

export default function TerritoryMap({
  config,
  data,
  initialYear,
  height = '70vh',
  hrefFor,
}: TerritoryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [year, setYear] = useState(() => initialYearFor(config, initialYear));
  const [selected, setSelected] = useState<Territory | Market | null>(null);
  // The map's own box, tracked by the ResizeObserver below. Drives the legend's
  // collapsed/expanded default; 0 until the first observation lands.
  const [box, setBox] = useState({ width: 0, height: 0 });
  // False until MapLibre has actually drawn the choropleth. See the `idle`
  // handler in the mount effect.
  const [painted, setPainted] = useState(false);

  const theme = useMemo(() => resolveTheme(config.theme), [config.theme]);
  const frame = useMemo(() => frameFor(year, data), [year, data]);
  const showMarkers = config.overlays?.includes('markets') ?? false;
  const showContested = config.overlays?.includes('contested') ?? false;
  // Optional single-territory focus (drives the "one territory's growth" video
  // and a shareable ?highlight=<id> deep link). Read once on mount.
  const [highlightId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('highlight');
  });

  // Chrome toggles for embedding. `?bare=1` is shorthand for hiding both the
  // legend and the year control, leaving nothing but the map itself.
  const [chrome] = useState(() => {
    if (typeof window === 'undefined') return { legend: true, controls: true };
    const q = new URLSearchParams(window.location.search);
    const off = (v: string | null) => v === '0' || v === 'false';
    const bare = q.get('bare') === '1' || q.get('bare') === 'true';
    return {
      legend: !bare && !off(q.get('legend')),
      controls: !bare && !off(q.get('controls')),
    };
  });

  // --- map init (once). Canonical MapLibre-in-React lifecycle: build the map,
  // keep the ref immediately, resize on container changes, and do all
  // style-dependent setup inside the one-shot `load` handler. ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const m = new maplibregl.Map({
      container,
      style: buildBaseStyle(config, theme),
      center: config.center,
      zoom: config.zoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      // The ResizeObserver below owns resizing. MapLibre's own window-resize
      // handler would otherwise resize the canvas without re-fitting, and its
      // stray camera event reads as the reader grabbing the map.
      trackResize: false,
      // Two fingers to pan, on touch devices only. With drag-pan and
      // touch-zoom-rotate both live, MapLibre sets `touch-action: none` over
      // the whole canvas, and this map is 92% of a phone's width and 76% of its
      // height. A reader scrolling the page hits it and stops: the swipe pans
      // the map, and the only way past is the page gutter. Cooperative gestures
      // relax `touch-action` back to `pan-x pan-y` and show a hint on a
      // one-finger attempt. Gated on pointer type, not size, because a mouse
      // never has this problem and would only lose its wheel zoom.
      cooperativeGestures: prefersCooperativeGestures(),
    });
    mapRef.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    m.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.error('[TerritoryMap] map error:', (e as { error?: unknown }).error ?? e);
    });

    // Keep the camera framing `config.bounds` at whatever size the container
    // settles at. Fitting once on `load` is not enough: `resize()` holds the
    // zoom it was given, and an iframe routinely reaches its final size after
    // the map has loaded, so the embed opens either cropped past the coasts or
    // adrift in whitespace. Re-fit on every resize until the reader takes the
    // camera themselves.
    const { bounds } = config;
    let readerDrivesCamera = false;

    const fitToBounds = () => {
      if (!bounds || readerDrivesCamera) return;
      m.fitBounds(bounds, { padding: FIT_PADDING, duration: 0 });
    };

    // A drag, the wheel, or a pinch reaches us as a camera event carrying the
    // DOM event behind it; our own fits never carry one. That tells the two
    // apart without any bookkeeping around our own calls.
    m.on('movestart', (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) readerDrivesCamera = true;
    });

    // The +/- buttons move the camera programmatically, so there is no DOM
    // event on the camera side to catch. Take the click instead.
    const onPointerDown = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.maplibregl-ctrl-group')) readerDrivesCamera = true;
    };
    container.addEventListener('pointerdown', onPointerDown, {
      capture: true,
      passive: true,
    });

    // The layout CSS is imported by this island and can land after the map is
    // constructed, so keep the GL canvas matched to its box. Resize and re-fit
    // only — never touch the style here (that stalls the load lifecycle).
    const ro = new ResizeObserver(() => {
      m.resize();
      fitToBounds();
      // Only the overlays read this, and they do not affect the container's
      // size, so this cannot feed back into the observer.
      setBox({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);

    m.once('load', () => {
      m.resize();
      fitToBounds();

      const hatch = hatchPattern(theme.territoryOutline);
      if (hatch && !m.hasImage(HATCH_IMAGE)) m.addImage(HATCH_IMAGE, hatch);
      m.addSource(SRC.contested, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: CONTESTED_LAYER,
        type: 'fill',
        source: SRC.contested,
        paint: { 'fill-pattern': HATCH_IMAGE, 'fill-opacity': 0.9 },
      });

      setMap(m);
      // Handles for the headless video exporter / debugging.
      const w = window as unknown as Record<string, unknown>;
      w.__tmMap = m;
      w.__tmReady = true;
    });

    // `load` means the style is up, not that the choropleth is drawn. The
    // county GeoJSON is 2.6 MB and still parsing in its worker at that point,
    // so on a phone the reader gets seconds of blank parchment. `idle` is the
    // honest signal: no further rendering expected. The timeout is a floor, so
    // a map that never settles reveals itself rather than hiding forever.
    const reveal = () => {
      setPainted(true);
      (window as unknown as Record<string, unknown>).__tmPainted = true;
    };
    m.once('idle', reveal);
    const paintFloor = setTimeout(reveal, PAINT_TIMEOUT_MS);

    return () => {
      clearTimeout(paintFloor);
      ro.disconnect();
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      m.remove();
      mapRef.current = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- expose year control for the video exporter ---
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setYear = (y: number) => setYear(y);
    w.__getYear = () => year;
    return () => {
      delete w.__setYear;
      delete w.__getYear;
    };
  }, [year]);

  // --- repaint Tier 1 (+ Tier 3) when the frame changes ---
  useEffect(() => {
    if (!map) return;
    map.setPaintProperty(
      LYR.countyFill,
      'fill-color',
      countyFillColor(frame.ownership, data.territories, theme, highlightId),
    );
    if (showContested) {
      const src = map.getSource(SRC.contested) as maplibregl.GeoJSONSource | undefined;
      src?.setData({
        type: 'FeatureCollection',
        features: frame.contested.map((z) => ({
          type: 'Feature' as const,
          geometry: z.geometry,
          properties: { id: z.id, label: z.label ?? '' },
        })),
      });
    }
  }, [map, frame, data.territories, theme, showContested, highlightId]);

  const selectedTerritory =
    selected && 'startYear' in selected && 'color' in selected
      ? (selected as Territory)
      : null;

  // Collapse the legend when the map is too small to give up the room. Both
  // dimensions matter: a portrait phone is narrow enough that the legend covers
  // the eastern third, and a landscape phone is short enough that it runs the
  // full height. Before the first measurement, assume there is room, so the
  // desktop render is never briefly a pill.
  const legendCompact =
    box.width > 0 &&
    (box.width < LEGEND_COMPACT_WIDTH || box.height < LEGEND_COMPACT_HEIGHT);

  return (
    <div
      className={[
        'tm-root',
        legendCompact ? 'tm-root--compact' : '',
        // Tells the stylesheet whether the bottom of the map is spoken for, so
        // the detail panel can dock above the year controls instead of on top
        // of them. How much room they need is a CSS question (it changes with
        // the touch tap targets), so the number lives beside those rules.
        chrome.controls ? 'tm-root--has-controls' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height, position: 'relative' }}
    >
      <div
        ref={containerRef}
        className="tm-canvas"
        style={{ position: 'absolute', inset: 0 }}
      />

      {chrome.legend && (
        <div className="tm-overlay tm-overlay--top-right">
          <MapLegend
            territories={frame.territories}
            selectedId={selectedTerritory?.id ?? null}
            onSelect={(t) => setSelected(t)}
            title={config.title}
            compact={legendCompact}
          />
        </div>
      )}

      {chrome.controls && (
        <div className="tm-overlay tm-overlay--bottom">
          <YearControls years={config.years} year={year} onChange={setYear} />
        </div>
      )}

      {showMarkers && (
        <MarkerLayer
          map={map}
          markets={
            highlightId
              ? frame.markets.filter((m) => m.territoryIds.includes(highlightId))
              : frame.markets
          }
          territories={data.territories}
          theme={theme}
          onSelect={(m) => setSelected(m)}
        />
      )}

      {!painted && (
        <div className="tm-loading" role="status" aria-live="polite">
          <span className="tm-loading-label">Drawing the map</span>
        </div>
      )}

      {selected && (
        <DetailPanel
          selected={selected}
          territories={data.territories}
          onClose={() => setSelected(null)}
          hrefFor={hrefFor}
        />
      )}
    </div>
  );
}

function DetailPanel({
  selected,
  territories,
  onClose,
  hrefFor,
}: {
  selected: Territory | Market;
  territories: Territory[];
  onClose: () => void;
  hrefFor?: (territoryId: string) => string;
}) {
  const isTerritory = 'color' in selected && 'startYear' in selected && !('lat' in selected);
  // The close button hangs off the panel and the content scrolls inside it.
  // Keeping them separate is what makes the panel safe to clamp: a territory's
  // meta runs to 427px, and a landscape map has 296px of height in total, so
  // whichever element owns the scroll must not also own the close button.
  return (
    <div className="tm-detail">
      <button type="button" className="tm-detail-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="tm-detail-body">
        {isTerritory ? (
          <TerritoryDetail t={selected as Territory} hrefFor={hrefFor} />
        ) : (
          <MarketDetail m={selected as Market} territories={territories} />
        )}
      </div>
    </div>
  );
}

function TerritoryDetail({
  t,
  hrefFor,
}: {
  t: Territory;
  hrefFor?: (territoryId: string) => string;
}) {
  const href = hrefFor?.(t.id);
  return (
    <div>
      <h3 className="tm-detail-title">
        <span className="tm-swatch" style={{ backgroundColor: t.color }} aria-hidden="true" />
        {href ? (
          <a className="tm-detail-link" href={href}>
            {t.name}
          </a>
        ) : (
          t.name
        )}
      </h3>
      <p className="tm-detail-years">
        {t.startYear}–{t.endYear}
      </p>
      {t.meta && (
        <dl className="tm-detail-meta">
          {Object.entries(t.meta)
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

function MarketDetail({ m, territories }: { m: Market; territories: Territory[] }) {
  const owners = m.territoryIds.map(
    (id) => territories.find((t) => t.id === id)?.name ?? id,
  );
  return (
    <div>
      <h3 className="tm-detail-title">{m.name}</h3>
      {m.tier && <p className="tm-detail-years">{m.tier} market</p>}
      <p className="tm-detail-owners">Run by: {owners.join(', ')}</p>
    </div>
  );
}
