import type { TideResponse } from '../shared/tide-response.js';
import { stationDayWindow } from '../shared/tides.js';
import type { DisplaySettings } from './display-settings.js';
import { parseTideResponse } from './graph-model.js';

export interface GraphState {
  data: TideResponse | null;
  preferences: DisplaySettings;
  now: number;
  loading: boolean;
  error: string | null;
}

/** Only active, visible display sessions may request predictions. */
export function createGraphController(options: {
  render: (state: GraphState) => void;
  fetch?: typeof fetch;
  now?: () => number;
  visible?: () => boolean;
  sessionActive?: () => boolean;
  intervalMilliseconds?: number;
}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const visible = options.visible ?? (() => true);
  let active = false;
  let stationId = '';
  let preferences: DisplaySettings = { heightUnit: 'ft', clockFormat: '12h' };
  let data: TideResponse | null = null;
  let generation = 0;
  let request: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  let error: string | null = null;
  function render() { options.render({ data, preferences: { ...preferences }, now: now(), loading, error }); }
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function mayRun() { return active && visible() && (options.sessionActive?.() ?? true); }
  function schedule() {
    clearTimer();
    if (mayRun()) timer = setTimeout(() => { void refresh(); }, options.intervalMilliseconds ?? 60_000);
  }
  async function refresh(force = false): Promise<void> {
    if (!mayRun() || request) return;
    clearTimer();
    const ownGeneration = generation;
    const abort = new AbortController();
    request = abort;
    loading = true;
    render();
    let invalidateData = false;
    try {
      const response = await fetcher(`/api/tides/${encodeURIComponent(stationId)}${force ? '?refresh=1' : ''}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok) {
        invalidateData = response.status === 422 || response.status === 404;
        if (response.status === 422) throw new Error('The station time zone is unavailable. Predictions cannot be shown safely.');
        throw new Error('NOAA predictions are unavailable. Please try again later.');
      }
      const next = parseTideResponse(await response.json() as unknown, stationId);
      if (!active || generation !== ownGeneration || abort.signal.aborted) return;
      data = next;
      error = null;
    } catch (failure) {
      if (!active || generation !== ownGeneration || abort.signal.aborted) return;
      const currentWindow = data?.station.timeZoneId ? stationDayWindow(now(), data.station.timeZoneId) : null;
      if (invalidateData || !currentWindow || currentWindow.start !== data?.window.start || currentWindow.end !== data?.window.end) data = null;
      error = failure instanceof Error ? failure.message : 'NOAA predictions are unavailable.';
    } finally {
      if (generation === ownGeneration && request === abort) {
        request = undefined;
        loading = false;
        if (active) { render(); schedule(); }
      }
    }
  }
  function stop() {
    active = false;
    generation++;
    request?.abort(); request = undefined;
    clearTimer(); data = null; loading = false; error = null;
    render();
  }
  return {
    start(location: { stationId: string }, settings: DisplaySettings) {
      stop(); active = true; stationId = location.stationId; preferences = { ...settings };
      void refresh();
    },
    setPreferences(settings: DisplaySettings) { preferences = { ...settings }; if (active) render(); },
    refresh,
    stop,
    visibilityChanged() {
      clearTimer();
      if (!mayRun()) { generation++; request?.abort(); request = undefined; loading = false; return; }
      void refresh();
    },
    destroy: stop,
  };
}
