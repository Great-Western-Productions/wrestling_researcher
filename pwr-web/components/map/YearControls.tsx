'use client';

/**
 * Year control. A range spec renders a scrub slider with play/pause; a
 * snapshot array renders a segmented selector. Controlled: the parent owns
 * `year` and receives changes via `onChange`.
 */
import { useEffect, useRef, useState } from 'react';
import type { YearSpec } from '@/lib/map/config';
import { isYearRange, yearExtent, yearList } from '@/lib/map/config';

export interface YearControlsProps {
  years: YearSpec;
  year: number;
  onChange: (year: number) => void;
  /** ms per step while playing. */
  stepMs?: number;
}

export default function YearControls({
  years,
  year,
  onChange,
  stepMs = 750,
}: YearControlsProps) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const yearRef = useRef(year);
  yearRef.current = year;

  const range = isYearRange(years);
  const [start, end] = yearExtent(years);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      const next = yearRef.current + 1;
      if (next > end) {
        setPlaying(false);
        return;
      }
      onChange(next);
    }, stepMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, end, onChange, stepMs]);

  if (!range) {
    const snapshots = yearList(years);
    return (
      <div className="tm-controls tm-controls--snapshots" role="group" aria-label="Snapshot year">
        {snapshots.map((y) => (
          <button
            key={y}
            type="button"
            className={`tm-snap${y === year ? ' is-active' : ''}`}
            aria-pressed={y === year}
            onClick={() => onChange(y)}
          >
            {y}
          </button>
        ))}
      </div>
    );
  }

  const atEnd = year >= end;
  return (
    <div className="tm-controls tm-controls--range">
      <button
        type="button"
        className="tm-play"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => {
          if (atEnd && !playing) onChange(start);
          setPlaying((p) => !p);
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        className="tm-slider"
        min={start}
        max={end}
        step={1}
        value={year}
        aria-label="Year"
        onChange={(e) => {
          setPlaying(false);
          onChange(Number(e.target.value));
        }}
      />
      <output className="tm-year-readout">{year}</output>
    </div>
  );
}
