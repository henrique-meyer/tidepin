import { describe, expect, it } from 'vitest';
import { buildChartData, type TideSample } from '../src/shared/tides.js';
import { oceanLevelFraction, oceanSurfacePercent, type OceanTideData } from '../src/client/ocean-level.js';

const samples: TideSample[] = [
  { time: 0, heightMeters: -1 },
  { time: 360, heightMeters: 0 },
  { time: 720, heightMeters: 1 },
];
const chartAt = (now: number) => buildChartData(samples, [], { start: 0, end: 721 }, now, true);

describe('ocean level from shared chart data', () => {
  it('maps low, middle and high predictions to a higher surface as the tide rises', () => {
    expect([0, 360, 720].map(time => oceanLevelFraction(chartAt(time)))).toEqual([0, 0.5, 1]);
    expect([0, 0.5, 1].map(oceanSurfacePercent)).toEqual([78, 51, 24]);
    expect(oceanLevelFraction(chartAt(180))).toBe(0.25);
  });

  it('uses only the supplied chart window and leaves canonical data unchanged', () => {
    const data = buildChartData(samples, [], { start: 180, end: 540 }, 360, true);
    const snapshot = structuredClone(data);
    expect(oceanLevelFraction(data)).toBe(0.5);
    expect(data).toEqual(snapshot);
    expect(samples[0]!.heightMeters).toBe(-1);
  });

  it('uses the exact same estimated chart/current level, with no separate ocean interpolation', () => {
    const events = [{ time: 0, heightMeters: -1, type: 'L' as const }, { time: 21600, heightMeters: 1, type: 'H' as const }];
    const estimated = (now: number) => buildChartData([], events, { start: 0, end: 21601 }, now, true, 'estimatedExtremes');
    expect(oceanLevelFraction(estimated(0))).toBe(0);
    expect(oceanLevelFraction(estimated(10800))).toBeCloseTo(0.5);
    expect(oceanLevelFraction(estimated(21600))).toBe(1);
    expect(oceanLevelFraction(estimated(21601))).toBeNull();
    expect(oceanLevelFraction(buildChartData([], [events[0]!], { start: 0, end: 21601 }, 100, true, 'estimatedExtremes'))).toBeNull();
  });

  it('returns a neutral state without a current prediction, usable range or finite height', () => {
    const flat = { chartPoints: [{ time: 0, heightMeters: 2 }], current: { time: 0, heightMeters: 2 } };
    for (const data of [null, { ...chartAt(0), current: null }, flat, { ...flat, chartPoints: [] }, { ...flat, current: { time: 0, heightMeters: NaN } }]) {
      expect(oceanLevelFraction(data)).toBeNull();
    }
    expect(oceanLevelFraction(buildChartData(samples, [], { start: 0, end: 721 }, 180, false))).toBeNull();
    expect(oceanSurfacePercent(null)).toBe(51);
    expect(oceanSurfacePercent(NaN)).toBe(51);
  });

  it('clamps exceptional out-of-range current heights and ignores nonfinite sample heights', () => {
    const data: OceanTideData = chartAt(360);
    data.chartPoints.push({ time: 721, heightMeters: Infinity });
    expect(oceanLevelFraction(data)).toBe(0.5);
    expect(oceanLevelFraction({ ...data, current: { time: 360, heightMeters: -10 } })).toBe(0);
    expect(oceanLevelFraction({ ...data, current: { time: 360, heightMeters: 10 } })).toBe(1);
    expect(oceanSurfacePercent(-10)).toBe(78);
    expect(oceanSurfacePercent(10)).toBe(24);
  });
});
