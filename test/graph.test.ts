import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGraphController, type GraphState } from '../src/client/graph-controller.js';
import { chartGeometry, displayHeight, eventLabelPositions, parseTideResponse, stationTicks } from '../src/client/graph-model.js';
import { buildChartData, formatStationTime, plotFraction, stationDayWindow } from '../src/shared/tides.js';
import type { TideResponse } from '../src/shared/tide-response.js';

const now = Date.parse('2026-11-01T17:00:00Z') / 1000;
function fixture(): TideResponse {
  const window = stationDayWindow(now, 'America/New_York')!;
  return {
    station: { id: '0012345', name: 'Fixture', latitude: 40, longitude: -74, timeZoneId: 'America/New_York', curveSupported: true },
    now, window,
    predictions: {
      stationId: '0012345', timeZoneId: 'America/New_York', datum: 'MLLW', units: 'metric',
      curve: { status: 'fresh', data: [{ time: now - 180, heightMeters: -0.3048 }, { time: now + 180, heightMeters: 0.3048 }], fetchedAt: now, coverage: window, error: null },
      events: { status: 'fresh', data: [{ time: now, heightMeters: 1, type: 'H' }, { time: now + 3600, heightMeters: -0.2, type: 'L' }], fetchedAt: now, coverage: window, error: null },
    },
  };
}
const preferences = { heightUnit: 'ft', clockFormat: '12h' } as const;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

describe('graph presentation', () => {
  it('keeps station wall-clock ticks at elapsed UTC positions across 23/25-hour days', () => {
    for (const [date, hours] of [['2026-03-08T12:00:00Z', 23], ['2026-11-01T12:00:00Z', 25]] as const) {
      const window = stationDayWindow(Date.parse(date) / 1000, 'America/New_York')!;
      const ticks = stationTicks(window, 'America/New_York', false);
      expect(ticks.map(tick => tick.label)).toEqual(['00:00', '06:00', '12:00', '18:00', '00:00']);
      expect(stationTicks(window, 'America/New_York', true).map(tick => tick.label)).toEqual(['12 AM', '6 AM', '12 PM', '6 PM', '12 AM']);
      expect(plotFraction(ticks[1]!.time, window)).toBeCloseTo((hours === 23 ? 5 : 7) / hours);
    }
  });
  it('distinguishes repeated local hours and moves colliding event labels inside narrow bounds', () => {
    const first = Date.parse('2026-11-01T05:30:00Z') / 1000;
    const second = first + 3600;
    expect(formatStationTime(first, 'America/New_York')).toContain('EDT (GMT-04:00)');
    expect(formatStationTime(second, 'America/New_York')).toContain('EST (GMT-05:00)');
    const events = [{ time: first, heightMeters: 1, type: 'H' as const }, { time: second, heightMeters: 1, type: 'H' as const }];
    const labels = eventLabelPositions(events, () => 45, () => 60, 272, 200, () => '1:30 AM');
    expect(labels[0]!.y).not.toBe(labels[1]!.y);
    expect(labels.every(label => label.x > 40 && label.x < 260 && label.y >= 32 && label.y <= 166)).toBe(true);
  });
  it('converts every geometric height from canonical meters and keeps at most five meaningful ticks', () => {
    const data = fixture();
    const chart = buildChartData(data.predictions.curve.data!, data.predictions.events.data!, data.window, now, true);
    const feet = chartGeometry(chart, data.window, 'ft');
    const meters = chartGeometry(chart, data.window, 'm');
    expect(feet.max).toBeCloseTo(1 / 0.3048 + 0.5);
    expect(meters.max).toBe(1.5);
    expect(feet.ticks.length).toBeLessThanOrEqual(5);
    expect(feet.ticks).toContain(0);
    expect(displayHeight(-0.3048, 'ft')).toBe('−1.0');
    expect(displayHeight(-0.3048, 'm')).toBe('−0.3');
    expect(data.predictions.curve.data![0]!.heightMeters).toBe(-0.3048);
  });
  it('rejects mismatched stations, missing coverage and corrupt products instead of drawing them', () => {
    expect(parseTideResponse(fixture(), '0012345').station.name).toBe('Fixture');
    expect(() => parseTideResponse(fixture(), '0012346')).toThrow();
    const corrupt = fixture(); corrupt.predictions.curve.data![0]!.heightMeters = NaN;
    expect(() => parseTideResponse(corrupt, '0012345')).toThrow();
    const missing = fixture(); missing.predictions.curve.coverage = { ...missing.window, start: missing.window.start + 1 };
    expect(() => parseTideResponse(missing, '0012345')).toThrow();
  });
  it('validates curve provenance against station capability without rejecting older responses', () => {
    const harmonic = fixture();
    harmonic.predictions.curveSource = 'sixMinute';
    expect(parseTideResponse(harmonic, '0012345')).toBe(harmonic);
    harmonic.predictions.curveSource = 'estimatedExtremes';
    expect(() => parseTideResponse(harmonic, '0012345')).toThrow('Invalid curve source.');
    const subordinate = fixture();
    subordinate.station.curveSupported = false;
    subordinate.predictions.curveSource = 'estimatedExtremes';
    subordinate.predictions.curve = { status: 'unsupported', data: null, fetchedAt: null, coverage: subordinate.window, error: null };
    expect(parseTideResponse(subordinate, '0012345')).toBe(subordinate);
    subordinate.predictions.curveSource = 'sixMinute';
    expect(() => parseTideResponse(subordinate, '0012345')).toThrow('Invalid curve source.');
    delete subordinate.predictions.curveSource;
    expect(parseTideResponse(subordinate, '0012345')).toBe(subordinate);
    expect(() => parseTideResponse({ ...subordinate, predictions: { ...subordinate.predictions, curveSource: 'unknown' } }, '0012345')).toThrow('Invalid curve source.');
  });
});

describe('visible display graph lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  function harness() {
    vi.useFakeTimers();
    let clock = now; let visible = true; let active = true;
    const states: GraphState[] = [];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture())));
    const graph = createGraphController({ render: state => states.push(state), fetch: fetcher, now: () => clock, visible: () => visible, sessionActive: () => active });
    return { graph, states, fetcher, hide: () => { visible = false; }, show: () => { visible = true; }, expire: () => { active = false; }, advanceDay: () => { clock += 86400; } };
  }
  it('does not fetch before Start, applies preferences without fetching, and polls only while visible', async () => {
    const { graph, fetcher, states, hide, show } = harness();
    await graph.refresh(); expect(fetcher).not.toHaveBeenCalled();
    graph.start({ stationId: '0012345' }, preferences); await flush();
    expect(states.at(-1)?.data?.station.id).toBe('0012345');
    graph.setPreferences({ heightUnit: 'm', clockFormat: '24h' });
    expect(states.at(-1)?.preferences).toEqual({ heightUnit: 'm', clockFormat: '24h' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    hide(); graph.visibilityChanged(); await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    show(); graph.visibilityChanged(); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(3);
    graph.destroy();
  });
  it('aborts on session end and rejects late results, including an expired hidden-session wake', async () => {
    const { graph, fetcher, states, hide, show, expire } = harness();
    let resolve!: (value: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    graph.start({ stationId: '0012345' }, preferences);
    const signal = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]![1].signal!;
    hide(); graph.visibilityChanged(); expect(signal.aborted).toBe(true);
    expire(); graph.stop(); show(); graph.visibilityChanged();
    resolve(new Response(JSON.stringify(fixture()))); await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.data).toBeNull();
  });
  it('retains covered data on transport failure, but never presents yesterday as today', async () => {
    const { graph, fetcher, states, advanceDay } = harness();
    graph.start({ stationId: '0012345' }, preferences); await flush();
    fetcher.mockRejectedValue(new Error('offline'));
    await graph.refresh(); expect(states.at(-1)?.data).not.toBeNull(); expect(states.at(-1)?.error).toBe('offline');
    advanceDay(); await graph.refresh(); expect(states.at(-1)?.data).toBeNull();
    graph.destroy();
  });
  it('clears previously covered predictions when the station zone becomes unavailable', async () => {
    const { graph, fetcher, states } = harness();
    graph.start({ stationId: '0012345' }, preferences); await flush();
    expect(states.at(-1)?.data).not.toBeNull();
    fetcher.mockResolvedValue(new Response('{}', { status: 422 }));
    await graph.refresh();
    expect(states.at(-1)?.data).toBeNull();
    expect(states.at(-1)?.error).toContain('time zone is unavailable');
    graph.destroy();
  });
  it('cannot let an old-station response replace a newer selection', async () => {
    const { graph, fetcher, states } = harness();
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    graph.start({ stationId: '0012345' }, preferences);
    const next = fixture(); next.station.id = '0012346'; next.predictions.stationId = '0012346';
    fetcher.mockResolvedValue(new Response(JSON.stringify(next)));
    graph.start({ stationId: '0012346' }, preferences); await flush();
    expect(states.at(-1)?.data?.station.id).toBe('0012346');
    finish(new Response(JSON.stringify(fixture()))); await flush();
    expect(states.at(-1)?.data?.station.id).toBe('0012346');
    graph.destroy();
  });
});
