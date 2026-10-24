import { buildChartData, formatHeight, heightInUnit, plotFraction, validTimeZone, type HeightUnit, type TideWindow } from '../shared/tides.js';
import { validStationCoordinates, validStationId } from '../shared/stations.js';
import type { TideResponse, PredictionProduct } from '../shared/tide-response.js';
import type { TideEvent, TideSample } from '../shared/tides.js';

/** A failed or malformed response must never become a plausible-looking tide. */
export function parseTideResponse(value: unknown, stationId: string): TideResponse {
  const data = value as TideResponse | null;
  const station = data?.station;
  const window = data?.window;
  if (!station || !validStationId(station.id) || station.id !== stationId || !validStationCoordinates(station) || typeof station.name !== 'string' || !station.name.trim() || typeof station.curveSupported !== 'boolean' || !station.timeZoneId || !validTimeZone(station.timeZoneId)
    || !window || !Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end) || window.end <= window.start || window.end - window.start > 26 * 3600 || !Number.isFinite(data?.now)
    || data?.predictions?.stationId !== stationId || data.predictions.timeZoneId !== station.timeZoneId || data.predictions.datum !== 'MLLW' || data.predictions.units !== 'metric') throw new Error('Invalid tide response.');
  function product(item: PredictionProduct<TideSample | TideEvent>, events: boolean): boolean {
    if (!item || !['fresh', 'saved', 'error', 'unsupported'].includes(item.status) || !item.coverage || !Number.isFinite(item.coverage.start) || !Number.isFinite(item.coverage.end) || (item.fetchedAt !== null && !Number.isFinite(item.fetchedAt))) return false;
    if (item.status === 'error' || item.status === 'unsupported') return item.data === null;
    if (!Array.isArray(item.data) || item.fetchedAt === null || item.coverage.start > window!.start || item.coverage.end < window!.end) return false;
    let previous = -Infinity;
    for (const row of item.data) {
      if (!row || !Number.isFinite(row.time) || !Number.isFinite(row.heightMeters) || row.time < previous || (events && (!('type' in row) || (row.type !== 'H' && row.type !== 'L')))) return false;
      previous = row.time;
    }
    return true;
  }
  const source = data.predictions.curveSource;
  if (source !== undefined && source !== (station.curveSupported ? 'sixMinute' : 'estimatedExtremes')) throw new Error('Invalid curve source.');
  if (!product(data.predictions.curve, false) || !product(data.predictions.events, true)) throw new Error('Invalid tide products.');
  return data;
}

export function chartGeometry(data: ReturnType<typeof buildChartData>, window: TideWindow, unit: HeightUnit, width = 1000, height = 300) {
  const heights = [...data.chartPoints, ...data.markers].map(row => heightInUnit(row.heightMeters, unit));
  const min = Math.min(0, ...heights) - 0.5;
  const max = Math.max(0, ...heights) + 0.5;
  let step = unit === 'ft' ? 1 : 0.5;
  const count = () => Math.floor(max / step) - Math.ceil(min / step) + 1;
  while (count() > 5) step *= 2;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + 1e-9; tick += step) ticks.push(Object.is(tick, -0) ? 0 : tick);
  const x = (time: number) => 40 + plotFraction(time, window) * (width - 52);
  const y = (meters: number) => 26 + (max - heightInUnit(meters, unit)) / (max - min) * (height - 52);
  return { min, max, ticks, x, y, path: (rows: readonly TideSample[]) => rows.map((row, i) => `${i ? 'L' : 'M'}${x(row.time).toFixed(2)},${y(row.heightMeters).toFixed(2)}`).join(' ') };
}

export function displayHeight(meters: number, unit: HeightUnit): string { return formatHeight(meters, unit).replace('-', '−'); }

export function localClock(time: number, zone: string, hour12: boolean): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12 }).format(time * 1000);
}

/** Tick instants follow local wall-clock labels; spacing follows real elapsed UTC. */
export function stationTicks(window: TideWindow, zone: string, hour12: boolean): { time: number; label: string }[] {
  const tickClock = (time: number) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', ...(hour12 ? {} : { minute: '2-digit' }), hour12 }).format(time * 1000);
  const ticks = [{ time: window.start, label: tickClock(window.start) }];
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let time = window.start + 1800; time < window.end; time += 1800) {
    if (['06:00', '12:00', '18:00'].includes(formatter.format(time * 1000))) ticks.push({ time, label: tickClock(time) });
  }
  ticks.push({ time: window.end, label: tickClock(window.end) });
  return ticks;
}

/** Clamp to the chart and move colliding event labels into neighboring lanes. */
export function eventLabelPositions(events: readonly TideEvent[], x: (time: number) => number, y: (meters: number) => number, width: number, height: number, label: (time: number) => string) {
  const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
  return events.map(event => {
    const text = label(event.time);
    const half = text.length * 3.2;
    const center = Math.max(40 + half, Math.min(width - 12 - half, x(event.time)));
    const direction = event.type === 'H' ? -1 : 1;
    const initial = y(event.heightMeters) + direction * 14;
    const candidates = [0, 14, 28, 42, -14, -28].map(offset => Math.max(32, Math.min(height - 34, initial + direction * offset)));
    const box = (baseline: number) => ({ left: center - half, right: center + half, top: baseline - 11, bottom: baseline + 3 });
    const baseline = candidates.find(candidate => {
      const next = box(candidate);
      return occupied.every(other => next.left > other.right + 4 || next.right < other.left - 4 || next.top > other.bottom + 2 || next.bottom < other.top - 2);
    }) ?? candidates[0]!;
    occupied.push(box(baseline));
    return { x: center, y: baseline, text, event };
  });
}
