import { describe, expect, it } from 'vitest';
import { buildChartData, estimateHeightFromExtremes, plotFraction, stationDayWindow, type TideEvent } from '../src/shared/tides.js';

const extremes: TideEvent[] = [
  { time: 0, heightMeters: -1, type: 'L' },
  { time: 21600, heightMeters: 3, type: 'H' },
  { time: 43200, heightMeters: -2, type: 'L' },
];
const chart = (now: number, events = extremes) => buildChartData([], events, { start: 0, end: 43201 }, now, true, 'estimatedExtremes');

describe('explicit half-cosine estimation from predicted extremes', () => {
  it('preserves each authoritative extreme exactly and has flat endpoint slopes', () => {
    for (const event of extremes) expect(estimateHeightFromExtremes(extremes, event.time)).toBe(event.heightMeters);
    expect(Math.abs(estimateHeightFromExtremes(extremes, 1)! - extremes[0]!.heightMeters)).toBeLessThan(1e-7);
    expect(Math.abs(estimateHeightFromExtremes(extremes, 21599)! - extremes[1]!.heightMeters)).toBeLessThan(1e-7);
    expect(Math.abs(estimateHeightFromExtremes(extremes, 21601)! - extremes[1]!.heightMeters)).toBeLessThan(1e-7);
    expect(Math.abs(estimateHeightFromExtremes(extremes, 43199)! - extremes[2]!.heightMeters)).toBeLessThan(1e-7);
  });

  it.each([[5400, -Math.SQRT2 + 1], [10800, 1], [16200, Math.SQRT2 + 1], [32400, 0.5]])('computes the analytic current at %s seconds', (time, expected) => {
    expect(estimateHeightFromExtremes(extremes, time)).toBeCloseTo(expected, 12);
    expect(chart(time).current).toEqual({ time, heightMeters: estimateHeightFromExtremes(extremes, time) });
  });

  it('is monotonic and bounded between consecutive extremes in either direction', () => {
    for (let segment = 0; segment < extremes.length - 1; segment++) {
      const first = extremes[segment]!;
      const last = extremes[segment + 1]!;
      let previous = first.heightMeters;
      for (let step = 1; step <= 100; step++) {
        const value = estimateHeightFromExtremes(extremes, first.time + (last.time - first.time) * step / 100)!;
        expect(value).toBeGreaterThanOrEqual(Math.min(first.heightMeters, last.heightMeters));
        expect(value).toBeLessThanOrEqual(Math.max(first.heightMeters, last.heightMeters));
        expect(last.heightMeters > first.heightMeters ? value >= previous : value <= previous).toBe(true);
        previous = value;
      }
    }
  });

  it('uses actual elapsed time for unequal cycles and does not force alternating event types', () => {
    const events: TideEvent[] = [{ time: 0, heightMeters: 1, type: 'H' }, { time: 36000, heightMeters: 2, type: 'H' }, { time: 43200, heightMeters: -1, type: 'L' }];
    expect(estimateHeightFromExtremes(events, 18000)).toBeCloseTo(1.5);
    expect(estimateHeightFromExtremes(events, 39600)).toBeCloseTo(0.5);
  });

  it('keeps exact drawing boundaries and non-grid extremes, with at most six-minute plot gaps', () => {
    const events = extremes.map((event, index) => ({ ...event, time: event.time + index * 60 }));
    const window = { start: 900, end: 40001 };
    const data = buildChartData([], events, window, 12345, true, 'estimatedExtremes');
    expect(data.curveSource).toBe('estimatedExtremes');
    expect(data.chartPoints[0]).toEqual({ time: window.start, heightMeters: estimateHeightFromExtremes(events, window.start) });
    expect(data.chartPoints.at(-1)).toEqual({ time: window.end, heightMeters: estimateHeightFromExtremes(events, window.end) });
    // Plot points carry canonical heights/times, while authoritative types stay in markers.
    expect(data.chartPoints.find(point => point.time === events[1]!.time)).toEqual({ time: events[1]!.time, heightMeters: events[1]!.heightMeters });
    expect(data.segments).toHaveLength(1);
    expect(data.chartPoints.every((point, index, points) => index === 0 || point.time - points[index - 1]!.time <= 360)).toBe(true);
    expect(data.current?.heightMeters).toBe(estimateHeightFromExtremes(events, 12345));
  });

  it('never extrapolates at uncovered edges and handles one extreme without inventing a curve', () => {
    const window = { start: -3600, end: 50000 };
    const data = buildChartData([], extremes, window, -1, true, 'estimatedExtremes');
    expect(data.chartPoints[0]!.time).toBe(0);
    expect(data.chartPoints.at(-1)!.time).toBe(43200);
    expect(data.current).toBeNull();
    for (const time of [-1, 43201]) expect(estimateHeightFromExtremes(extremes, time)).toBeNull();
    const one = [extremes[1]!];
    const single = chart(21600, one);
    expect(single.chartPoints).toEqual([{ time: 21600, heightMeters: 3 }]);
    expect(single.current).toEqual({ time: 21600, heightMeters: 3 });
    expect(chart(21599, one).current).toBeNull();
    expect(chart(21601, one).current).toBeNull();
    expect(buildChartData([], one, { start: 22000, end: 23000 }, 22500, true, 'estimatedExtremes').chartPoints).toEqual([]);
  });

  it('leaves empty, invalid and ambiguous extrema without an estimate', () => {
    expect(chart(100, []).chartPoints).toEqual([]);
    expect(chart(100, []).current).toBeNull();
    for (const events of [
      [...extremes].reverse(),
      [{ ...extremes[0]!, heightMeters: NaN }, extremes[1]!],
      [{ ...extremes[0]!, time: Infinity }, extremes[1]!],
      [extremes[0]!, { ...extremes[1]!, time: 0 }],
    ]) {
      expect(estimateHeightFromExtremes(events, 100)).toBeNull();
      expect(chart(100, events).chartPoints).toEqual([]);
    }
  });

  it('keeps actual next events and end-exclusive daily markers, and never estimates harmonic gaps', () => {
    const window = { start: 0, end: 21600 };
    const estimated = buildChartData([], extremes, window, 0, true, 'estimatedExtremes');
    expect(estimated.markers).toEqual([extremes[0]]);
    expect(estimated.nextLow).toEqual(extremes[0]);
    expect(estimated.nextHigh).toEqual(extremes[1]);
    expect(estimated.chartPoints.at(-1)).toEqual({ time: 21600, heightMeters: 3 });
    expect(buildChartData([], extremes, window, 10800, false, 'estimatedExtremes').current).toBeNull();
    const harmonic = buildChartData([{ time: 0, heightMeters: 0 }, { time: 720, heightMeters: 2 }], extremes, window, 360, true);
    expect(harmonic.curveSource).toBe('sixMinute');
    expect(harmonic.current).toBeNull();
    expect(harmonic.segments).toHaveLength(2);
  });

  it.each([['2026-03-08T12:00:00Z', 23], ['2026-11-01T12:00:00Z', 25]] as const)('covers both station-local DST edges on %s', (instant, hours) => {
    const now = Date.parse(instant) / 1000;
    const window = stationDayWindow(now, 'America/New_York')!;
    const events: TideEvent[] = [];
    for (let time = window.start - 3600, index = 0; time <= window.end + 21600; time += 21600, index++) events.push({ time, heightMeters: index % 2, type: index % 2 ? 'H' : 'L' });
    const data = buildChartData([], events, window, now, true, 'estimatedExtremes');
    expect(window.end - window.start).toBe(hours * 3600);
    expect(data.chartPoints[0]!.time).toBe(window.start);
    expect(data.chartPoints.at(-1)!.time).toBe(window.end);
    expect(data.current?.heightMeters).toBe(estimateHeightFromExtremes(events, now));
    expect(plotFraction(window.start + 3600, window)).toBe(1 / hours);
  });
});
