/**
 * Pure SVG builder for Tier-2 market markers. One owner -> a filled disc.
 * Multiple owners -> equal pie wedges, one per owning territory. Kept
 * DOM-free and side-effect-free so it is trivially unit-testable; the React
 * layer wraps the returned string in a MapLibre marker element.
 */
export interface SplitMarkerOptions {
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
}

const DEFAULTS: Required<SplitMarkerOptions> = {
  radius: 7,
  stroke: "#2a2213",
  strokeWidth: 1,
};

/** Point on the circle at `angle` radians (0 = up, clockwise), SVG coords. */
function pointOnCircle(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  };
}

/** An SVG string sized to fit `radius` (+ stroke) with a transparent bg. */
export function splitMarkerSvg(colors: string[], options: SplitMarkerOptions = {}): string {
  const { radius, stroke, strokeWidth } = { ...DEFAULTS, ...options };
  const pad = strokeWidth + 1;
  const size = (radius + pad) * 2;
  const cx = size / 2;
  const cy = size / 2;
  const slices = colors.length > 0 ? colors : ["#999999"];

  let inner: string;
  if (slices.length === 1) {
    inner = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${slices[0]}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  } else {
    const step = (2 * Math.PI) / slices.length;
    const large = step > Math.PI ? 1 : 0;
    inner = slices
      .map((color, i) => {
        const a0 = i * step;
        const a1 = (i + 1) * step;
        const p0 = pointOnCircle(cx, cy, radius, a0);
        const p1 = pointOnCircle(cx, cy, radius, a1);
        const d = [
          `M ${cx} ${cy}`,
          `L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`,
          `A ${radius} ${radius} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
          "Z",
        ].join(" ");
        return `<path d="${d}" fill="${color}" />`;
      })
      .join("");
    inner += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="tm-marker-svg">${inner}</svg>`;
}

/** Marker radius by market tier. Trimmed ~15% so dense clusters stay readable. */
export function radiusForTier(tier?: string): number {
  switch (tier) {
    case "Primary":
      return 7.6;
    case "Secondary":
      return 5.5;
    case "Tertiary":
      return 3.8;
    default:
      return 5.1;
  }
}
