import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { createNoaaClient } from '../src/server/noaa-client.js';
import { stationDayWindow } from '../src/shared/tides.js';

describe('daily tide HTTP boundary', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
  async function harness(timeZoneId: string | null = 'America/New_York', curveSupported = true) {
    let clock = Date.parse('2026-11-01T17:00:00Z') / 1000;
    const fetcher = vi.fn(async () => new Response('{"predictions":[]}'));
    const predictions = createNoaaClient({ fetch: fetcher, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; } });
    const getPredictions = vi.spyOn(predictions, 'getPredictions');
    const station = { id: 'TEC1603', name: 'Fixture station', latitude: 40, longitude: -74, timeZoneId, curveSupported };
    const stations = { get: vi.fn(async () => station), nearest: vi.fn(async () => station) };
    const app = await buildApp({ stationClient: stations, predictionClient: predictions, now: () => clock });
    cleanup.push(() => app.close());
    return { app, predictions, getPredictions, stations, fetcher, clock };
  }
  it('computes the current station-local 25-hour day and returns independently typed products', async () => {
    const { app, getPredictions, clock } = await harness();
    const response = await app.inject('/api/tides/TEC1603');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body.window).toEqual(stationDayWindow(clock, 'America/New_York'));
    expect(body.window.end - body.window.start).toBe(25 * 3600);
    expect(body.predictions.datum).toBe('MLLW');
    expect(body.predictions.units).toBe('metric');
    expect(getPredictions).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'TEC1603', timeZoneId: 'America/New_York', forceRefresh: false }));
  });
  it('supports explicit refresh, but never asks for a subordinate curve', async () => {
    const { app, getPredictions, fetcher } = await harness('America/New_York', false);
    const response = await app.inject('/api/tides/TEC1603?refresh=1');
    expect(response.json().predictions.curve.status).toBe('unsupported');
    expect(getPredictions).toHaveBeenCalledWith(expect.objectContaining({ curveSupported: false, forceRefresh: true }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails closed for unavailable zones and validates IDs before any upstream call', async () => {
    const { app, getPredictions, stations } = await harness(null);
    expect((await app.inject('/api/tides/not-an-id')).statusCode).toBe(400);
    expect(stations.get).not.toHaveBeenCalled();
    const response = await app.inject('/api/tides/TEC1603');
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('timeZoneUnavailable');
    expect(getPredictions).not.toHaveBeenCalled();
    stations.get.mockRejectedValue(new Error('private diagnostic'));
    const failed = await app.inject('/api/tides/TEC1603');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private diagnostic');
  });
});
