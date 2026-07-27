import { describe, expect, it } from 'vitest';
import { radiusForTier, splitMarkerSvg } from '@/lib/map/splitMarker';

describe('splitMarkerSvg', () => {
  it('renders a single filled disc for one owner', () => {
    const svg = splitMarkerSvg(['#ff0000']);
    expect(svg).toContain('<circle');
    expect(svg).toContain('#ff0000');
    expect(svg).not.toContain('<path');
  });

  it('renders one wedge path per owner when shared', () => {
    const svg = splitMarkerSvg(['#ff0000', '#00ff00']);
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
    expect(svg).toContain('#ff0000');
    expect(svg).toContain('#00ff00');
    // plus an outline circle around the pie
    expect(svg).toContain('<circle');
  });

  it('handles three owners', () => {
    const svg = splitMarkerSvg(['#111', '#222', '#333']);
    expect((svg.match(/<path/g) ?? []).length).toBe(3);
  });

  it('falls back to a neutral disc for no owners', () => {
    const svg = splitMarkerSvg([]);
    expect(svg).toContain('<circle');
  });

  it('scales the viewBox with radius', () => {
    const big = splitMarkerSvg(['#000'], { radius: 20 });
    expect(big).toMatch(/viewBox="0 0 \d+ \d+"/);
  });
});

describe('radiusForTier', () => {
  it('orders Primary > Secondary > Tertiary', () => {
    expect(radiusForTier('Primary')).toBeGreaterThan(radiusForTier('Secondary'));
    expect(radiusForTier('Secondary')).toBeGreaterThan(radiusForTier('Tertiary'));
  });
  it('has a default for unknown tiers', () => {
    expect(radiusForTier(undefined)).toBeGreaterThan(0);
  });
});
