import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedStationZone, createStationClient, StationLookupError } from '../src/server/station-client.js';
import { stationDistanceMeters } from '../src/shared/stations.js';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';

const sampleRows = [
  { id: '0012345', name: 'Reference station', lat: 40, lng: -74, type: 'R', timezonecorr: -5 },
  { id: '0012346', name: 'Subordinate station', lat: 41, lng: -74, type: 'S', timezonecorr: -5 },
  { id: 'TEC1603', name: 'Alphanumeric subordinate', lat: 42.7, lng: -73.7, type: 'S', timezonecorr: -5 },
];
const expectedStation = { id: '0012345', name: 'Reference station', latitude: 40, longitude: -74, curveSupported: true, timeZoneId: 'America/New_York' };
function harness() {
  let clock = Date.parse('2026-01-01T00:00:00Z') / 1000;
  const calls: { url: string; at: number }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); calls.push({ url, at: clock });
    return new Response(JSON.stringify({ stations: url.includes('?type=') ? sampleRows : [{ ...sampleRows.find(row => url.includes(row.id)), observedst: true }] }));
  });
  const client = createStationClient({ fetch: fetcher, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; }, lookupZones: () => ['America/New_York'] });
  return { client, calls, fetcher, advance: (seconds: number) => { clock += seconds; } };
}

describe('NOAA station discovery', () => {
  it('resolves nearest prediction station and checked IANA zone with paced/coalesced metadata requests', async () => {
    const { client, fetcher, calls } = harness();
    const [first, second] = await Promise.all([client.nearest({ latitude: 40.01, longitude: -74 }), client.get('0012345')]);
    expect(first).toEqual(expectedStation); expect(second).toEqual(expectedStation);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls[0]!.url).toBe('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(1);
    first.name = 'Caller mutation'; expect((await client.get('0012345'))?.name).toBe('Reference station');
  });
  it('includes subordinate stations with no invented curve, excludes unknown station IDs', async () => {
    const { client } = harness();
    const station = await client.nearest({ latitude: 40.99, longitude: -74 });
    expect(station.id).toBe('0012346'); expect(station.curveSupported).toBe(false);
    expect(await client.get('9999999')).toBeUndefined();
    expect(await client.get('../private')).toBeUndefined();
    expect((await client.get('TEC1603'))?.curveSupported).toBe(false);
  });
  it('reuses metadata for seven days and retains the last valid catalog during an offline refresh', async () => {
    const { client, fetcher, advance } = harness();
    await client.get('0012345'); await client.get('0012345'); expect(fetcher).toHaveBeenCalledTimes(2);
    advance(604800); fetcher.mockRejectedValue(new Error('offline'));
    expect((await client.nearest({ latitude: 40, longitude: -74 })).id).toBe('0012345');
    const count = fetcher.mock.calls.length;
    await client.get('0012345'); expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('fails typed and backs off malformed/failed metadata without caching a corrupt catalog', async () => {
    const { client, fetcher } = harness();
    fetcher.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(client.get('0012345')).rejects.toBeInstanceOf(StationLookupError);
    await expect(client.get('0012345')).rejects.toBeInstanceOf(StationLookupError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const malformed = harness(); malformed.fetcher.mockImplementation(async () => new Response(JSON.stringify({ stations: [{ ...sampleRows[0], lat: 100 }] })));
    await expect(malformed.client.get('0012345')).rejects.toBeInstanceOf(StationLookupError);
    await expect(malformed.client.get('0012345')).rejects.toBeInstanceOf(StationLookupError);
    expect(malformed.fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses great-circle distance across the date line and near the poles', () => {
    expect(stationDistanceMeters({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 })).toBeLessThan(23000);
    expect(stationDistanceMeters({ latitude: 89.9, longitude: 0 }, { latitude: 89.9, longitude: 180 })).toBeLessThan(23000);
  });
  it('fails closed on invalid, ambiguous or NOAA-inconsistent geographic time zones', () => {
    expect(checkedStationZone(['America/New_York'], -5, true, 2026)).toBe('America/New_York');
    expect(checkedStationZone(['Etc/GMT+5'], -5, true, 2026)).toBeNull();
    expect(checkedStationZone(['America/Chicago'], -5, null, 2026)).toBeNull();
    expect(checkedStationZone(['America/New_York', 'America/Detroit'], -5, true, 2026)).toBeNull();
    expect(checkedStationZone(['America/New_York'], null, null, 2026)).toBeNull();
    expect(checkedStationZone(['invalid'], -5, true, 2026)).toBeNull();
  });
});

describe('station HTTP/privacy boundary', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
  async function app() {
    const stations = { nearest: vi.fn(async () => ({ ...expectedStation })), get: vi.fn(async (id: string) => id === '0012345' ? { ...expectedStation } : undefined) };
    const instance = await buildApp({ stationClient: stations, config: loadConfig({ GOOGLE_MAPS_API_KEY: 'fixture-browser-key', GOOGLE_MAPS_MAP_ID: 'fixture-map', UNRELATED_SECRET: 'must-not-leak' }) });
    cleanup.push(() => instance.close()); return { instance, stations };
  }
  it('exposes only browser-safe runtime fields with no response caching', async () => {
    const { instance } = await app(); const response = await instance.inject('/api/config');
    expect(response.json()).toEqual({ googleMapsApiKey: 'fixture-browser-key', googleMapsMapId: 'fixture-map', sessionLimitMinutes: 120 });
    expect(response.headers['cache-control']).toBe('no-store'); expect(response.body).not.toContain('must-not-leak');
  });
  it('validates coordinate bounds before the upstream and sends only coordinates to lookup', async () => {
    const { instance, stations } = await app();
    for (const payload of [{ latitude: 91, longitude: 0 }, { latitude: 0 }, { latitude: 'not-coordinate', longitude: 0 }]) expect((await instance.inject({ method: 'POST', url: '/api/stations/nearest', payload })).statusCode).toBe(400);
    expect(stations.nearest).not.toHaveBeenCalled();
    const response = await instance.inject({ method: 'POST', url: '/api/stations/nearest', payload: { latitude: 40, longitude: -74, address: 'must not reach lookup', search: 'private query' } });
    expect(response.statusCode).toBe(200); expect(stations.nearest).toHaveBeenCalledWith({ latitude: 40, longitude: -74 });
  });
  it('returns clear station-not-found/upstream failures without exposing exception text', async () => {
    const { instance, stations } = await app();
    expect((await instance.inject('/api/stations/9999999')).statusCode).toBe(404);
    expect((await instance.inject('/api/stations/not-an-id')).statusCode).toBe(400);
    stations.nearest.mockRejectedValue(new Error('private upstream body'));
    const response = await instance.inject({ method: 'POST', url: '/api/stations/nearest', payload: { latitude: 40, longitude: -74 } });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('private upstream body');
  });
});
