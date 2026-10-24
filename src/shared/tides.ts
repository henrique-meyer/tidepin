/** NOAA predicted heights relative to MLLW. Times are UTC Unix seconds. */
export interface TideSample { time: number; heightMeters: number }
export interface TideEvent extends TideSample { type: 'H' | 'L' }
export interface TideWindow { start: number; end: number }
export type HeightUnit = 'ft' | 'm';
/** A display estimate is explicitly distinct from NOAA's sampled prediction product. */
export type CurveSource = 'sixMinute' | 'estimatedExtremes';
export type ParsedProduct<T> = { ok: true; data: T[] } | { ok: false; message: string };

export function parseNoaaTime(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return null;
  const time = Date.parse(value.replace(' ', 'T') + ':00Z') / 1000;
  return Number.isFinite(time) && new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ') === value ? time : null;
}

function parseHeight(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizePredictions(payload: unknown, interval: '6'): ParsedProduct<TideSample>;
export function normalizePredictions(payload: unknown, interval: 'hilo'): ParsedProduct<TideEvent>;
export function normalizePredictions(payload: unknown, interval: '6' | 'hilo'): ParsedProduct<TideSample | TideEvent> {
  if (!payload || typeof payload !== 'object' || 'error' in payload || !('predictions' in payload) || !Array.isArray(payload.predictions)) {
    return { ok: false, message: 'NOAA returned an invalid predictions product.' };
  }
  const records = new Map<string, TideSample | TideEvent>();
  for (const raw of payload.predictions) {
    if (!raw || typeof raw !== 'object') return { ok: false, message: 'Invalid prediction row.' };
    const row = raw as Record<string, unknown>;
    const time = parseNoaaTime(row.t);
    const heightMeters = parseHeight(row.v);
    if (time === null || heightMeters === null || (interval === 'hilo' && row.type !== 'H' && row.type !== 'L')) {
      return { ok: false, message: 'Invalid prediction row.' };
    }
    const key = interval === 'hilo' ? `${time}:${String(row.type)}` : String(time);
    const existing = records.get(key);
    if (existing && existing.heightMeters !== heightMeters) return { ok: false, message: 'Conflicting prediction rows.' };
    records.set(key, interval === 'hilo' ? { time, heightMeters, type: row.type as 'H' | 'L' } : { time, heightMeters });
  }
  return { ok: true, data: [...records.values()].sort((a, b) => a.time - b.time || ('type' in a && a.type === 'H' ? -1 : 1)) };
}

export function interpolateHeight(samples: readonly TideSample[], time: number): number | null {
  let before: TideSample | undefined;
  for (const sample of samples) {
    if (sample.time === time) return sample.heightMeters;
    if (sample.time > time) {
      if (!before || sample.time - before.time > 360) return null;
      return before.heightMeters + (sample.heightMeters - before.heightMeters) * (time - before.time) / (sample.time - before.time);
    }
    before = sample;
  }
  return null;
}

function validExtremes(events: readonly TideEvent[]): boolean {
  return events.every((event, index) => Number.isFinite(event.time) && Number.isFinite(event.heightMeters)
    && (event.type === 'H' || event.type === 'L') && (index === 0 || event.time > events[index - 1]!.time));
}

function estimateBetweenExtremes(events: readonly TideEvent[], time: number): number | null {
  if (!Number.isFinite(time) || !events.length || time < events[0]!.time || time > events.at(-1)!.time) return null;
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle]!.time < time) low = middle + 1;
    else high = middle;
  }
  const after = events[low]!;
  if (after.time === time) return after.heightMeters;
  const before = events[low - 1]!;
  const fraction = (time - before.time) / (after.time - before.time);
  const weight = (1 - Math.cos(Math.PI * fraction)) / 2;
  return before.heightMeters + (after.heightMeters - before.heightMeters) * weight;
}

/** Half-cosine estimate between consecutive real predicted extremes; never extrapolates. */
export function estimateHeightFromExtremes(events: readonly TideEvent[], time: number): number | null {
  return validExtremes(events) ? estimateBetweenExtremes(events, time) : null;
}

function estimatedChartPoints(events: readonly TideEvent[], window: TideWindow): TideSample[] {
  if (!events.length) return [];
  const start = Math.max(window.start, events[0]!.time);
  const end = Math.min(window.end, events.at(-1)!.time);
  if (start > end) return [];
  // Bound plotting work to the largest window accepted by the server client.
  if (end - start > 366 * 86400 || Math.abs(start) > 8e12 || Math.abs(end) > 8e12) throw new RangeError('Invalid estimated chart window.');
  const times = new Set([start, end]);
  for (let time = Math.ceil(start / 360) * 360; time <= end; time += 360) times.add(time);
  for (const event of events) if (event.time >= start && event.time <= end) times.add(event.time);
  return [...times].sort((a, b) => a - b).map(time => ({ time, heightMeters: estimateBetweenExtremes(events, time)! }));
}

export function buildChartData(samples: readonly TideSample[], events: readonly TideEvent[], window: TideWindow, now: number, isToday: boolean, curveSource: CurveSource = 'sixMinute') {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end <= window.start) throw new RangeError('Invalid chart window.');
  const estimated = curveSource === 'estimatedExtremes';
  const usableExtremes = estimated && validExtremes(events);
  const points = estimated ? usableExtremes ? estimatedChartPoints(events, window) : [] : samples.filter(sample => sample.time >= window.start && sample.time <= window.end).map(sample => ({ ...sample }));
  for (const time of estimated ? [] : [window.start, window.end]) {
    if (!points.some(point => point.time === time)) {
      const heightMeters = interpolateHeight(samples, time);
      if (heightMeters !== null) points.push({ time, heightMeters });
    }
  }
  const chartPoints = [...new Map(points.map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
  const segments: TideSample[][] = [];
  for (const point of chartPoints) {
    const segment = segments.at(-1);
    if (!segment || point.time - segment[segment.length - 1]!.time > 360) segments.push([point]);
    else segment.push(point);
  }
  const future = events.filter(event => event.time >= now).slice().sort((a, b) => a.time - b.time || (a.type === 'H' ? -1 : 1));
  const currentHeight = isToday && now >= window.start && now < window.end
    ? estimated ? usableExtremes ? estimateBetweenExtremes(events, now) : null : interpolateHeight(samples, now) : null;
  return {
    curveSource, chartPoints, segments,
    markers: events.filter(event => event.time >= window.start && event.time < window.end),
    current: currentHeight === null ? null : { time: now, heightMeters: currentHeight },
    nextHigh: future.find(event => event.type === 'H') ?? null,
    nextLow: future.find(event => event.type === 'L') ?? null,
    nextEvent: future[0] ?? null,
  };
}

export function plotFraction(time: number, window: TideWindow): number {
  return (time - window.start) / (window.end - window.start);
}

export function heightInUnit(meters: number, unit: HeightUnit): number {
  return unit === 'ft' ? meters / 0.3048 : meters;
}

export function formatHeight(meters: number, unit: HeightUnit = 'ft'): string {
  const value = heightInUnit(meters, unit);
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 10 + Number.EPSILON * Math.abs(value) * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

export function validTimeZone(timeZoneId: string): boolean {
  if (timeZoneId !== 'UTC' && !timeZoneId.includes('/')) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: timeZoneId }).format(0); return true; }
  catch { return false; }
}

function localDate(time: number, timeZoneId: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time * 1000);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

function startOfDate(date: string, timeZoneId: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`) / 1000;
  let low = guess - 48 * 3600;
  let high = guess + 48 * 3600;
  // Find the first valid instant of the local date (earlier occurrence of repeated midnight).
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(middle, timeZoneId) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Calendar arithmetic in the station zone, including 23/25-hour DST days. */
export function stationDayWindow(now: number, timeZoneId: string, days = 1): TideWindow | null {
  if (!Number.isFinite(now) || !validTimeZone(timeZoneId) || !Number.isInteger(days) || days < 1 || days > 7) return null;
  const date = localDate(now, timeZoneId);
  const endDate = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return { start: startOfDate(date, timeZoneId), end: startOfDate(endDate, timeZoneId) };
}

/** Always includes the station zone and offset, disambiguating repeated hours. */
export function formatStationTime(time: number, timeZoneId: string, hour12 = true, includeDate = false): string | null {
  if (!validTimeZone(timeZoneId) || !Number.isFinite(time)) return null;
  const base = new Intl.DateTimeFormat('en-US', { timeZone: timeZoneId, hour: 'numeric', minute: '2-digit', hour12, timeZoneName: 'short', ...(includeDate ? { month: 'short', day: 'numeric' } as const : {}) }).format(time * 1000);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: timeZoneId, timeZoneName: 'longOffset' }).formatToParts(time * 1000).find(part => part.type === 'timeZoneName')!.value;
  return `${base} (${offset})`;
}
