import type { buildChartData } from '../shared/tides.js';

/** Use the graph's already computed window and interpolated current height. */
export type OceanTideData = Pick<ReturnType<typeof buildChartData>, 'chartPoints' | 'current'>;

/** Null means no meaningful relative level, rather than a fabricated current prediction. */
export function oceanLevelFraction(data: OceanTideData | null): number | null {
  if (!data?.current || !Number.isFinite(data.current.heightMeters)) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const point of data.chartPoints) {
    if (!Number.isFinite(point.heightMeters)) continue;
    low = Math.min(low, point.heightMeters);
    high = Math.max(high, point.heightMeters);
  }
  const range = high - low;
  if (!Number.isFinite(range) || range < 0.000001) return null;
  return Math.max(0, Math.min(1, (data.current.heightMeters - low) / range));
}

/** Leave breathing room above and below the water at both ends of the chart range. */
export function oceanSurfacePercent(fraction: number | null): number {
  return fraction === null || !Number.isFinite(fraction) ? 51 : 78 - 54 * Math.max(0, Math.min(1, fraction));
}
