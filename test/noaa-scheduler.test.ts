import { describe, expect, it, vi } from 'vitest';
import { createNoaaScheduler, NoaaBackoffError } from '../src/server/noaa-scheduler.js';
import { createNoaaClient } from '../src/server/noaa-client.js';
import { createStationClient } from '../src/server/station-client.js';

describe('shared NOAA scheduler', () => {
  it('serializes metadata and both prediction products, including unfinished bodies, at one-second starts', async () => {
    let clock = 1767225600;
    const starts: number[] = [];
    let consume!: () => void;
    const firstBody = new Promise<void>(resolve => { consume = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      starts.push(clock);
      const url = String(input);
      const payload = url.includes('mdapi') ? { stations: [{ id: '0012345', name: 'Reference', lat: 40, lng: -74, type: 'R', timezonecorr: -5, observedst: true }] } : { predictions: [] };
      return { ok: true, json: async () => { if (starts.length === 1) await firstBody; return payload; } } as Response;
    });
    const scheduler = createNoaaScheduler({ fetch: fetcher, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; } });
    const stations = createStationClient({ scheduler, now: () => clock, lookupZones: () => ['America/New_York'] });
    const predictions = createNoaaClient({ scheduler, now: () => clock });
    const pendingStation = stations.get('0012345');
    const pendingPredictions = predictions.getPredictions({ stationId: '0012345', timeZoneId: 'America/New_York', start: clock, end: clock + 86400 });
    await Promise.resolve(); await Promise.resolve();
    expect(starts).toHaveLength(1);
    consume();
    await Promise.all([pendingStation, pendingPredictions]);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(1);
  });
  it.each(['120', 'Thu, 01 Jan 2026 00:02:00 GMT'])('propagates Retry-After %s to already queued metadata and predictions', async header => {
    let clock = 1767225600;
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': header } }));
    const scheduler = createNoaaScheduler({ fetch: fetcher, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; } });
    const first = scheduler.download('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter');
    const second = scheduler.download('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json');
    await first;
    await expect(second).rejects.toMatchObject({ retryAt: 1767225720 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 119;
    await expect(scheduler.download('https://api.tidesandcurrents.noaa.gov/')).rejects.toBeInstanceOf(NoaaBackoffError);
    clock++;
    await scheduler.download('https://api.tidesandcurrents.noaa.gov/');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['network', 'timeout', 'json', 'envelope'])('backs off both clients after a %s failure', async mode => {
    let clock = 1767225600;
    const fetcher = vi.fn(async () => {
      if (mode === 'network') throw new Error('offline');
      if (mode === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
      return new Response(mode === 'json' ? 'not JSON' : '{"error":{"message":"Unavailable"}}');
    });
    const scheduler = createNoaaScheduler({ fetch: fetcher, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; } });
    const predictions = createNoaaClient({ scheduler, now: () => clock });
    const stations = createStationClient({ scheduler, now: () => clock });
    const result = await predictions.getPredictions({ stationId: '0012345', timeZoneId: 'America/New_York', start: clock, end: clock + 86400 });
    expect(result.curve.error?.code).toBe(mode === 'network' || mode === 'timeout' ? 'network' : 'invalidProduct');
    expect(result.events.error).toMatchObject({ code: 'throttled', retryAt: clock + 60 });
    await expect(stations.get('0012345')).rejects.toThrow();
    clock += 59;
    await expect(stations.get('0012346')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock++;
    await expect(stations.get('0012345')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
