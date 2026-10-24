import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildChartData, formatHeight, formatStationTime, heightInUnit, interpolateHeight, normalizePredictions, parseNoaaTime, plotFraction, stationDayWindow } from '../src/shared/tides.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tides.json', import.meta.url), 'utf8')) as {
  curve: unknown; events: unknown;
  expected: { times: number[]; heights: number[]; interpolatedAt180: number; segmentLengths: number[] };
};
const start = 1767225600;
const curveResult = normalizePredictions(fixture.curve, '6');
const eventResult = normalizePredictions(fixture.events, 'hilo');
if (!curveResult.ok || !eventResult.ok) throw new Error('Invalid frozen fixture.');
const samples = curveResult.data;
const events = eventResult.data;

describe('canonical NOAA normalization', () => {
  it('sorts and collapses identical duplicates while preserving negative meters', () => {
    expect(samples.map(sample => sample.time)).toEqual(fixture.expected.times);
    expect(samples.map(sample => sample.heightMeters)).toEqual(fixture.expected.heights);
    expect(events.map(event => event.type)).toEqual(['H', 'L', 'H']);
  });
  it('invalidates entire products on conflicting duplicates or malformed rows', () => {
    expect(normalizePredictions({ predictions: [{ t: '2026-01-01 00:00', v: '1' }, { t: '2026-01-01 00:00', v: '2' }] }, '6').ok).toBe(false);
    expect(normalizePredictions({ predictions: [{ t: '2026-01-01 00:00', v: '1', type: 'X' }] }, 'hilo').ok).toBe(false);
    for (const v of ['', 'NaN', 'Infinity', '1 meter', '0x10', null]) expect(normalizePredictions({ predictions: [{ t: '2026-01-01 00:00', v }] }, '6').ok).toBe(false);
    expect(normalizePredictions({ predictions: [{ t: '2026-02-30 00:00', v: '1' }] }, '6').ok).toBe(false);
  });
  it('accepts empty products but rejects NOAA error envelopes and wrong shapes', () => {
    expect(normalizePredictions({ predictions: [] }, '6')).toEqual({ ok: true, data: [] });
    expect(normalizePredictions({ error: { message: 'No data.' } }, '6').ok).toBe(false);
    expect(normalizePredictions({}, '6').ok).toBe(false);
  });
  it('always parses NOAA time as UTC and rejects invalid dates', () => {
    expect(parseNoaaTime('2026-01-01 00:00')).toBe(start);
    for (const value of ['2026-13-01 00:00', '2026-01-01 24:00', '2026-01-01T00:00Z', undefined]) expect(parseNoaaTime(value)).toBeNull();
  });
});

describe('pure tide chart fixture', () => {
  it('interpolates exact instants and gaps up to six minutes without extrapolation', () => {
    expect(interpolateHeight(samples, start)).toBe(-1.2);
    expect(interpolateHeight(samples, start + 180)).toBeCloseTo(fixture.expected.interpolatedAt180, 9);
    expect(interpolateHeight(samples, start + 900)).toBeNull();
    expect(interpolateHeight(samples, start - 1)).toBeNull();
    expect(interpolateHeight(samples, start + 2000)).toBeNull();
  });
  it('keeps a drawing endpoint, separates gaps, and marks now at its actual instant', () => {
    const chart = buildChartData(samples, events, { start, end: start + 1440 }, start + 180, true);
    expect(chart.segments.map(segment => segment.length)).toEqual(fixture.expected.segmentLengths);
    expect(chart.current).toEqual({ time: start + 180, heightMeters: -0.6 });
    expect(chart.nextEvent?.type).toBe('H');
  });
  it('interpolates both boundary points only when covered by adjacent samples', () => {
    const chart = buildChartData(samples, events, { start: start + 180, end: start + 540 }, start, false);
    expect(chart.chartPoints).toEqual([{ time: start + 180, heightMeters: -0.6 }, { time: start + 360, heightMeters: 0 }, { time: start + 540, heightMeters: 0.6 }]);
    expect(chart.current).toBeNull();
    expect(buildChartData(samples, events, { start: start + 900, end: start + 1800 }, start, false).chartPoints).toEqual([{ time: start + 1440, heightMeters: 0.5 }]);
  });
  it('includes exact-event equality, excludes past events and end-boundary markers', () => {
    const chart = buildChartData(samples, events, { start, end: start + 86400 }, start + 360, true);
    expect(chart.nextHigh?.time).toBe(start + 360);
    expect(chart.nextLow?.time).toBe(start + 360);
    expect(chart.markers).toHaveLength(2);
    expect(buildChartData(samples, events, { start, end: start + 86400 }, start + 361, true).nextLow).toBeNull();
    expect(buildChartData([], [], { start, end: start + 86400 }, start, true).current).toBeNull();
  });
  it('uses elapsed seconds for horizontal position and rejects invalid windows', () => {
    expect(plotFraction(start + 3600, { start, end: start + 23 * 3600 })).toBe(1 / 23);
    expect(() => buildChartData([], [], { start, end: start }, start, true)).toThrow(RangeError);
  });
});

describe('station-local time and units', () => {
  it.each([
    ['2026-03-08T12:00:00Z', 1, 23], ['2026-11-01T12:00:00Z', 1, 25],
    ['2026-03-07T12:00:00Z', 7, 167], ['2026-10-31T12:00:00Z', 7, 169],
  ])('calculates DST window %s over %s calendar days', (instant, days, hours) => {
    const window = stationDayWindow(Date.parse(instant) / 1000, 'America/New_York', days)!;
    expect(window.end - window.start).toBe(hours * 3600);
  });
  it('uses the station date when it differs from UTC or device time', () => {
    const window = stationDayWindow(Date.parse('2026-01-01T03:00:00Z') / 1000, 'Pacific/Honolulu')!;
    expect(new Date(window.start * 1000).toISOString()).toBe('2025-12-31T10:00:00.000Z');
    expect(stationDayWindow(start, 'Unknown/Station')).toBeNull();
  });
  it('labels repeated local hours with the station abbreviation and numeric offset', () => {
    const earlier = formatStationTime(Date.parse('2026-11-01T05:30:00Z') / 1000, 'America/New_York')!;
    const later = formatStationTime(Date.parse('2026-11-01T06:30:00Z') / 1000, 'America/New_York')!;
    expect(earlier).toContain('1:30');
    expect(earlier).toContain('GMT-04:00');
    expect(later).toContain('GMT-05:00');
    expect(formatStationTime(start, 'invalid')).toBeNull();
  });
  it('converts canonical meters exactly and rounds display ties away from zero', () => {
    expect(heightInUnit(0.3048, 'ft')).toBe(1);
    expect(formatHeight(0.3048)).toBe('1.0');
    expect(formatHeight(-1.25, 'm')).toBe('-1.3');
    expect(formatHeight(1.25, 'm')).toBe('1.3');
    expect(formatHeight(-0.01, 'm')).toBe('0.0');
  });
});
