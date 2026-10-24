import { describe, expect, it, vi } from 'vitest';
import { createNoaaClient } from '../src/server/noaa-client.js';

const request = { stationId: '0012345', timeZoneId: 'America/New_York', start: 1767225600, end: 1767312000 };

function harness() {
  let clock = request.start;
  const starts: number[] = [];
  const fetcher = vi.fn(async () => {
    starts.push(clock);
    return new Response(JSON.stringify({ predictions: [] }), { status: 200 });
  });
  const client = createNoaaClient({ fetch: fetcher as unknown as typeof fetch, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; } });
  return { client, fetcher, starts, advance: (seconds: number) => { clock += seconds; } };
}

describe('NOAA predictions client', () => {
  it('requests separate padded six-minute and hilo predictions in GMT and canonical meters', async () => {
    const { client, fetcher, starts } = harness();
    const result = await client.getPredictions(request);
    expect(result.curve.status).toBe('fresh');
    expect(result.events.status).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
    const curve = calls[0]![0].searchParams;
    const events = calls[1]![0].searchParams;
    expect(curve.get('station')).toBe('0012345');
    expect(curve.get('product')).toBe('predictions');
    expect(curve.get('datum')).toBe('MLLW');
    expect(curve.get('units')).toBe('metric');
    expect(curve.get('time_zone')).toBe('gmt');
    expect(curve.get('interval')).toBe('6');
    expect(curve.get('begin_date')).toBe('20251231 23:54');
    expect(curve.get('end_date')).toBe('20260102 00:06');
    expect(events.get('interval')).toBe('hilo');
    expect(events.get('begin_date')).toBe('20251231 00:00');
    expect(events.get('end_date')).toBe('20260103 00:00');
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1);
    expect(calls[0]![1].headers).toEqual({ Accept: 'application/json' });
  });
  it('coalesces concurrent identical requests and reuses valid superset coverage', async () => {
    const { client, fetcher } = harness();
    await Promise.all([client.getPredictions(request), client.getPredictions(request)]);
    await client.getPredictions({ ...request, start: request.start + 3600, end: request.end - 3600 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('isolates caller-owned arrays, rows, coverage and errors from cache and coalesced callers', async () => {
    let clock = request.start;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const interval = new URL(String(input)).searchParams.get('interval');
      return new Response(JSON.stringify({ predictions: [{ t: '2026-01-01 00:00', v: '1', ...(interval === 'hilo' ? { type: 'H' } : {}) }] }));
    });
    const client = createNoaaClient({ fetch: fetcher, now: () => clock, sleep: async milliseconds => { clock += milliseconds / 1000; } });
    const [first, other] = await Promise.all([client.getPredictions(request), client.getPredictions(request)]);
    const originalCoverage = { ...other.curve.coverage };
    first.curve.data![0]!.heightMeters = 999;
    first.curve.data!.length = 0;
    first.curve.coverage.start = -1;
    first.events.data![0]!.type = 'L';
    expect(other.curve.data).toEqual([{ time: request.start, heightMeters: 1 }]);
    expect(other.curve.coverage).toEqual(originalCoverage);
    expect(other.events.data![0]!.type).toBe('H');

    const cached = await client.getPredictions(request);
    expect(cached.curve.data).toEqual(other.curve.data);
    cached.curve.data![0]!.heightMeters = 777;
    cached.curve.coverage.end = -1;
    clock += 21600;
    fetcher.mockRejectedValue(new Error('offline'));
    const [saved, otherSaved] = await Promise.all([client.getPredictions(request), client.getPredictions(request)]);
    expect(saved.curve.status).toBe('saved');
    expect(saved.curve.data).toEqual([{ time: request.start, heightMeters: 1 }]);
    expect(saved.curve.coverage).toEqual(originalCoverage);
    saved.curve.data![0]!.heightMeters = 555;
    saved.curve.coverage.start = -1;
    saved.curve.error!.message = 'caller changed this message';
    expect(otherSaved.curve.data).toEqual([{ time: request.start, heightMeters: 1 }]);
    expect(otherSaved.curve.coverage).toEqual(originalCoverage);
    expect(otherSaved.curve.error?.code).toBe('network');
    expect(otherSaved.curve.error?.message).not.toBe(saved.curve.error!.message);
  });
  it('refreshes at TTL equality and keeps products isolated by station', async () => {
    const { client, fetcher, advance } = harness();
    await client.getPredictions(request);
    await client.getPredictions(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(21600);
    await client.getPredictions(request);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await client.getPredictions({ ...request, stationId: '0012346' });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('preserves independent valid cache when an HTTP-200 NOAA error product fails', async () => {
    const { client, fetcher, advance } = harness();
    await client.getPredictions(request);
    advance(21600);
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: 'No predictions.' } })));
    const result = await client.getPredictions(request);
    expect(result.curve.status).toBe('saved');
    expect(result.curve.error?.code).toBe('invalidProduct');
    expect(result.curve.data).toEqual([]);
    expect(result.events.status).toBe('fresh');
  });
  it('returns typed network errors and uses cached coverage offline without throwing', async () => {
    const first = harness();
    first.fetcher.mockRejectedValue(new Error('offline'));
    const missing = await first.client.getPredictions(request);
    expect(missing.curve.status).toBe('error');
    expect(missing.curve.error?.code).toBe('network');
    expect(missing.events.data).toBeNull();
    const saved = harness();
    await saved.client.getPredictions(request);
    saved.advance(21600);
    saved.fetcher.mockRejectedValue(new Error('offline'));
    expect((await saved.client.getPredictions(request)).curve.status).toBe('saved');
  });
  it('honors longer Retry-After and rejects immediate manual refresh attempts', async () => {
    const { client, fetcher, advance } = harness();
    fetcher.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    const result = await client.getPredictions(request);
    expect(result.curve.error?.code).toBe('http');
    advance(60);
    const retry = await client.getPredictions({ ...request, forceRefresh: true });
    expect(retry.curve.error?.code).toBe('throttled');
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(61);
    await client.getPredictions(request);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('allows high/low-only stations without inventing a curve', async () => {
    const { client, fetcher } = harness();
    const result = await client.getPredictions({ ...request, curveSupported: false });
    expect(result.curve.status).toBe('unsupported');
    expect(result.curve.error?.code).toBe('curveUnavailable');
    expect(result.events.status).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('accepts NOAA TEC identifiers and rejects invalid/traversal station input', async () => {
    const { client, fetcher } = harness();
    const result = await client.getPredictions({ ...request, stationId: 'TEC1603', curveSupported: false });
    expect(result.events.status).toBe('fresh');
    const calls = fetcher.mock.calls as unknown as [URL][];
    expect(calls[0]![0].searchParams.get('station')).toBe('TEC1603');
    expect(calls[0]![0].searchParams.get('interval')).toBe('hilo');
    for (const stationId of ['A1', '12345678', '../secret', 'TEC1603/..', 'é123456']) {
      expect((await client.getPredictions({ ...request, stationId })).events.error?.code).toBe('invalidRequest');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('splits long coverage into at most thirty elapsed days with shared boundaries', async () => {
    const { client, fetcher } = harness();
    await client.getPredictions({ ...request, end: request.start + 32 * 86400 });
    const calls = fetcher.mock.calls as unknown as [URL][];
    expect(calls).toHaveLength(4);
    for (const [url] of calls) {
      const parse = (name: string) => Date.parse(url.searchParams.get(name)!.replace(/^(\d{4})(\d{2})(\d{2}) (.*)$/, '$1-$2-$3T$4:00Z'));
      expect(parse('end_date') - parse('begin_date')).toBeLessThanOrEqual(30 * 86400000);
    }
    const curve = calls.map(call => call[0]).filter(url => url.searchParams.get('interval') === '6');
    expect(curve[0]!.searchParams.get('end_date')).toBe(curve[1]!.searchParams.get('begin_date'));
  });
  it('rejects invalid station IDs, windows and unknown IANA zones before any network request', async () => {
    const { client, fetcher } = harness();
    expect((await client.getPredictions({ ...request, stationId: '../secret' })).curve.error?.code).toBe('invalidRequest');
    expect((await client.getPredictions({ ...request, timeZoneId: 'invalid' })).curve.error?.code).toBe('timeZoneUnavailable');
    expect((await client.getPredictions({ ...request, end: request.start })).curve.error?.code).toBe('invalidRequest');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
