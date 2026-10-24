import { createNoaaScheduler, sharedNoaaScheduler, type NoaaScheduler } from './noaa-scheduler.js';
import { stationDistanceMeters, validStationCoordinates, validStationId, type StationCoordinates, type TideStation } from '../shared/stations.js';
import { validTimeZone } from '../shared/tides.js';
import { lookupStationZones } from './station-zones.js';

interface CatalogStation extends StationCoordinates { id: string; name: string; curveSupported: boolean; standardOffset: number | null }
interface StationCache { station: TideStation; fetchedAt: number }
export interface StationClient {
  nearest(point: StationCoordinates): Promise<TideStation>;
  get(id: string): Promise<TideStation | undefined>;
}
export interface StationClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  scheduler?: NoaaScheduler;
  lookupZones?: (latitude: number, longitude: number) => readonly string[];
}
const metadataBase = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations';
const metadataTtl = 604800;

export class StationLookupError extends Error {
  constructor() { super('NOAA tide stations are unavailable. Please try again later.'); }
}

function numericOffset(time: Date, zone: string): number | null {
  const text = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(time).find(part => part.type === 'timeZoneName')?.value;
  if (text === 'GMT') return 0;
  const match = text?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) + Number(match[3]) / 60) : null;
}

/** Geographic IANA candidates must agree with NOAA's standard offset and DST metadata where supplied. */
export function checkedStationZone(candidates: readonly string[], standardOffset: number | null, observedDst: boolean | null, year: number): string | null {
  if (standardOffset === null) return null;
  const matching = [...new Set(candidates)].filter(zone => {
    // geo-tz uses longitude-based ocean fallbacks outside mapped land boundaries.
    // A matching numeric offset alone cannot establish the station's local rules.
    if (zone.startsWith('Etc/GMT') || !validTimeZone(zone)) return false;
    const january = numericOffset(new Date(Date.UTC(year, 0, 15, 12)), zone);
    const july = numericOffset(new Date(Date.UTC(year, 6, 15, 12)), zone);
    if (january === null || july === null || Math.min(january, july) !== standardOffset) return false;
    return observedDst === null || observedDst === (january !== july);
  });
  return matching.length === 1 ? matching[0]! : null;
}

function catalogRows(payload: unknown): CatalogStation[] {
  if (!payload || typeof payload !== 'object' || !('stations' in payload) || !Array.isArray(payload.stations) || 'error' in payload) throw new StationLookupError();
  const rows: CatalogStation[] = [];
  const ids = new Set<string>();
  for (const value of payload.stations) {
    if (!value || typeof value !== 'object') throw new StationLookupError();
    const row = value as Record<string, unknown>;
    const point = { latitude: row.lat as number, longitude: row.lng as number };
    if (!validStationId(row.id) || typeof row.name !== 'string' || !row.name.trim() || !validStationCoordinates(point) || (row.type !== 'R' && row.type !== 'S') || ids.has(row.id)) throw new StationLookupError();
    ids.add(row.id);
    rows.push({ id: row.id, name: row.name, ...point, curveSupported: row.type === 'R', standardOffset: typeof row.timezonecorr === 'number' && Number.isFinite(row.timezonecorr) && Math.abs(row.timezonecorr) <= 14 ? row.timezonecorr : null });
  }
  if (!rows.length) throw new StationLookupError();
  return rows;
}

export function createStationClient(options: StationClientOptions = {}): StationClient {
  const scheduler = options.scheduler ?? (options.fetch || options.now || options.sleep ? createNoaaScheduler(options) : sharedNoaaScheduler);
  const now = options.now ?? (() => Date.now() / 1000);
  const lookupZones = options.lookupZones ?? lookupStationZones;
  let catalog: { rows: CatalogStation[]; fetchedAt: number } | undefined;
  let catalogPending: Promise<CatalogStation[]> | undefined;
  const details = new Map<string, StationCache>();
  const pending = new Map<string, Promise<TideStation>>();
  let retryAt = -Infinity;

  async function load(url: string): Promise<unknown> {
    if (now() < retryAt) throw new StationLookupError();
    try {
      const { response, payload, jsonOk } = await scheduler.download(url);
      if (!response.ok || !jsonOk || !payload || typeof payload !== 'object' || 'error' in payload) throw new StationLookupError();
      return payload;
    } catch { retryAt = Math.max(retryAt, now() + 60); throw new StationLookupError(); }
  }
  async function list(): Promise<CatalogStation[]> {
    const age = catalog ? now() - catalog.fetchedAt : Infinity;
    if (catalog && age >= 0 && age < metadataTtl) return catalog.rows;
    if (catalogPending) return catalogPending;
    catalogPending = (async () => {
      try {
        const payload = await load(`${metadataBase}.json?type=tidepredictions`);
        let rows: CatalogStation[];
        try { rows = catalogRows(payload); }
        catch (error) { scheduler.deferUntil(now() + 60); throw error; }
        catalog = { rows, fetchedAt: now() };
        return rows;
      } catch { if (now() >= retryAt) retryAt = now() + 60; if (catalog) return catalog.rows; throw new StationLookupError(); }
    })();
    try { return await catalogPending; } finally { catalogPending = undefined; }
  }

  async function hydrate(row: CatalogStation): Promise<TideStation> {
    const cached = details.get(row.id);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (cached && age >= 0 && age < metadataTtl) return { ...cached.station };
    const existing = pending.get(row.id);
    if (existing) return { ...await existing };
    const operation = (async () => {
      let observedDst: boolean | null = null;
      let offset = row.standardOffset;
      try {
        const payload = await load(`${metadataBase}/${row.id}.json`) as { stations?: Record<string, unknown>[] };
        const detail = payload.stations?.find(value => value.id === row.id);
        if (detail) {
          if (typeof detail.observedst === 'boolean') observedDst = detail.observedst;
          if (typeof detail.timezonecorr === 'number' && Number.isFinite(detail.timezonecorr) && Math.abs(detail.timezonecorr) <= 14) offset = detail.timezonecorr;
        }
      } catch {
        if (cached) return { ...cached.station };
        // A first lookup can still use catalog metadata plus geographic boundaries.
      }
      let timeZoneId: string | null = null;
      try { timeZoneId = checkedStationZone(lookupZones(row.latitude, row.longitude), offset, observedDst, new Date(now() * 1000).getUTCFullYear()); } catch { /* Keep discoverable with unavailable local time. */ }
      const station: TideStation = { id: row.id, name: row.name, latitude: row.latitude, longitude: row.longitude, curveSupported: row.curveSupported, timeZoneId };
      details.set(row.id, { station, fetchedAt: now() });
      while (details.size > 100) details.delete(details.keys().next().value!);
      return station;
    })();
    pending.set(row.id, operation);
    try { return { ...await operation }; } finally { pending.delete(row.id); }
  }

  return {
    async nearest(point) {
      if (!validStationCoordinates(point)) throw new RangeError('Invalid coordinates.');
      const rows = await list();
      let nearest = rows[0]!;
      let distance = stationDistanceMeters(point, nearest);
      for (const row of rows.slice(1)) {
        const next = stationDistanceMeters(point, row);
        if (next < distance || (next === distance && row.id < nearest.id)) { nearest = row; distance = next; }
      }
      return hydrate(nearest);
    },
    async get(id) {
      if (!validStationId(id)) return undefined;
      const row = (await list()).find(value => value.id === id);
      return row ? hydrate(row) : undefined;
    },
  };
}
