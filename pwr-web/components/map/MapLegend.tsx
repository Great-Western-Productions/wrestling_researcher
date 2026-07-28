"use client";

/**
 * Territory legend for the active year. Swatch + name, and (optionally) the
 * currently selected territory highlighted. Presentational only.
 *
 * `compact` collapses the list behind a tappable pill. On a phone-width map the
 * expanded list blankets the eastern third of the geography, which is exactly
 * where the territories it names are drawn, so the caller decides when the map
 * no longer has room for it and the reader opens it on demand.
 */
import type { MouseEvent } from "react";
import type { Territory } from "@/lib/map/config";

export interface MapLegendProps {
  territories: Territory[];
  selectedId?: string | null;
  onSelect?: (t: Territory) => void;
  title?: string;
  /** Collapse to a pill that expands on tap. TerritoryMap owns the rule. */
  compact?: boolean;
}

export default function MapLegend({
  territories,
  selectedId,
  onSelect,
  title = "Territories",
  compact = false,
}: MapLegendProps) {
  if (territories.length === 0) return null;
  const sorted = [...territories].sort((a, b) => a.name.localeCompare(b.name));

  // Picking a territory opens the detail panel, which on a small map is a sheet
  // across the bottom. Leaving the list open behind it stacks two overlays on a
  // map that has room for neither, so the list gets out of the way.
  const collapseAfterSelect = (e: MouseEvent<HTMLButtonElement>) => {
    if (!compact) return;
    e.currentTarget.closest("details")?.removeAttribute("open");
  };

  const list = (
    <ul className="tm-legend-list">
      {sorted.map((t) => {
        const active = selectedId === t.id;
        return (
          <li key={t.id}>
            <button
              type="button"
              className={`tm-legend-item${active ? " is-active" : ""}`}
              onClick={(e) => {
                onSelect?.(t);
                collapseAfterSelect(e);
              }}
              aria-pressed={active}
            >
              <span className="tm-swatch" style={{ backgroundColor: t.color }} aria-hidden="true" />
              <span className="tm-legend-name">{t.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  // <details> carries the open/closed state, the keyboard handling, and the
  // accessible name for free, and it starts closed with no extra state.
  if (compact) {
    return (
      <details className="tm-legend tm-legend--compact">
        <summary className="tm-legend-toggle">
          <span className="tm-legend-toggle-label">{title}</span>
          <span className="tm-legend-count">{sorted.length}</span>
          <span className="tm-legend-caret" aria-hidden="true" />
        </summary>
        {list}
      </details>
    );
  }

  return (
    <div className="tm-legend">
      <div className="tm-legend-title">{title}</div>
      {list}
    </div>
  );
}
