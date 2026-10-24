import type { NoaaError, PredictionProduct, Predictions } from '../shared/tide-response.js';
export type { NoaaError, PredictionProduct, Predictions } from '../shared/tide-response.js';
import { createNoaaScheduler, sharedNoaaScheduler, NoaaBackoffError, type NoaaScheduler } from './noaa-scheduler.js';
import { normalizePredictions, validTimeZone, type CurveSource, type TideEvent, type TideSample, type TideWindow } from '../shared/tides.js';
import { validStationId } from '../shared/stations.js';

export interface PredictionRequest extends TideWindow {
  stationId: string;
  timeZoneId: string;
  curveSupported?: boolean;
  forceRefresh?: boolean;
}
interface CacheEntry<T> extends TideWindow { data: T[]; fetchedAt: number }
interface Attempt { at: number; retryAt: number }
export interface NoaaClientOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  scheduler?: NoaaScheduler;
  cacheTtlSeconds?: number;
  maxCacheEntries?: number;
}

const endpoint = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const maxRequestSeconds = 30 * 86400;
const defaultTtl = 21600;

function requestDate(time: number): string {
  return new Date(time * 1000).toISOString().slice(0, 16).replaceAll('-', '').replace('T', ' ');
}

function emptyProduct<T>(coverage: TideWindow, error: NoaaError, unsupported = false): PredictionProduct<T> {
  return { status: unsupported ? 'unsupported' : 'error', data: null, fetchedAt: null, coverage, error };
}

/** Each caller owns its result, including results sharing an in-flight download. */
function snapshotProduct<T extends TideSample>(product: PredictionProduct<T>): PredictionProduct<T> {
  return {
    ...product,
    data: product.data?.map(row => ({ ...row })) ?? null,
    coverage: { start: product.coverage.start, end: product.coverage.end },
    error: product.error ? { ...product.error } : null,
  };
}

/** In-memory predictions only. No credentials, observations, addresses or search text. */
export function createNoaaClient(options: NoaaClientOptions = {}) {
  const scheduler = options.scheduler ?? (options.fetch || options.now || options.sleep ? createNoaaScheduler(options) : sharedNoaaScheduler);
  const now = options.now ?? (() => Date.now() / 1000);
  const ttl = options.cacheTtlSeconds ?? defaultTtl;
  const maxEntries = options.maxCacheEntries ?? 100;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > defaultTtl || !Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid cache settings.');
  const cache = new Map<string, CacheEntry<TideSample | TideEvent>>();
  const attempts = new Map<string, Attempt>();
  const inFlight = new Map<string, Promise<PredictionProduct<TideSample | TideEvent>>>();

  function save(key: string, entry: CacheEntry<TideSample | TideEvent>) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  }

  function recordAttempt(key: string, attempt: Attempt) {
    attempts.delete(key);
    attempts.set(key, attempt);
    while (attempts.size > maxEntries * 2) attempts.delete(attempts.keys().next().value!);
  }

  async function loadProduct(request: PredictionRequest, interval: '6' | 'hilo'): Promise<PredictionProduct<TideSample | TideEvent>> {
    const padding = interval === '6' ? 360 : 86400;
    const coverage = { start: Math.floor((request.start - padding) / 60) * 60, end: Math.ceil((request.end + padding) / 60) * 60 };
    const prefix = `${request.stationId}:MLLW:metric:${interval}:v1:`;
    const key = `${prefix}${coverage.start}:${coverage.end}`;
    const cached = [...cache.entries()].reverse().find(([entryKey, entry]) => entryKey.startsWith(prefix) && entry.start <= coverage.start && entry.end >= coverage.end)?.[1];
    const age = cached ? now() - cached.fetchedAt : Infinity;
    const dataFromCache = (error: NoaaError | null, fresh = false): PredictionProduct<TideSample | TideEvent> => ({
      status: fresh ? 'fresh' : 'saved',
      data: cached!.data.filter(row => row.time >= coverage.start && row.time <= coverage.end),
      fetchedAt: cached!.fetchedAt, coverage, error,
    });
    if (!request.forceRefresh && cached && age >= 0 && age < ttl) return dataFromCache(null, true);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const attempt = attempts.get(key);
    if (attempt && now() >= attempt.at && now() < attempt.retryAt) {
      const error: NoaaError = { code: 'throttled', message: 'Please wait before refreshing these predictions.', retryAt: attempt.retryAt };
      return cached ? dataFromCache(error) : emptyProduct(coverage, error);
    }
    const operation = (async (): Promise<PredictionProduct<TideSample | TideEvent>> => {
      const startedAt = now();
      recordAttempt(key, { at: startedAt, retryAt: startedAt + 60 });
      const collected: (TideSample | TideEvent)[] = [];
      let failure: NoaaError | null = null;
      for (let start = coverage.start; start <= coverage.end;) {
        const end = Math.min(coverage.end, start + maxRequestSeconds);
        const url = new URL(endpoint);
        url.search = new URLSearchParams({ product: 'predictions', application: 'Tidepin', datum: 'MLLW', units: 'metric', time_zone: 'gmt', format: 'json', interval, station: request.stationId, begin_date: requestDate(start), end_date: requestDate(end) }).toString();
        try {
          const { response, payload, jsonOk } = await scheduler.download(url);
          if (!response.ok) {
            const retryHeader = response.headers.get('retry-after');
            let retryAt = now() + 60;
            if (retryHeader) {
              const seconds = Number(retryHeader);
              const specified = Number.isFinite(seconds) ? now() + Math.max(0, seconds) : Date.parse(retryHeader) / 1000;
              if (Number.isFinite(specified)) retryAt = Math.max(retryAt, specified);
            }
            failure = { code: 'http', message: `NOAA predictions request failed (HTTP ${response.status}).`, retryAt };
            break;
          }
          if (!jsonOk) { failure = { code: 'invalidProduct', message: 'NOAA returned malformed JSON.', retryAt: now() + 60 }; break; }
          const normalized = interval === '6' ? normalizePredictions(payload, '6') : normalizePredictions(payload, 'hilo');
          if (!normalized.ok) { failure = { code: 'invalidProduct', message: normalized.message, retryAt: now() + 60 }; scheduler.deferUntil(failure.retryAt!); break; }
          collected.push(...normalized.data);
        } catch (error) {
          if (error instanceof NoaaBackoffError) { failure = { code: 'throttled', message: error.message, retryAt: error.retryAt }; break; }
          failure = { code: 'network', message: 'NOAA predictions are unavailable. Saved predictions may still be used.', retryAt: now() + 60 };
          break;
        }
        if (end === coverage.end) break;
        start = end; // Keep the shared boundary sample; normalization checks conflicts.
      }
      if (failure) {
        recordAttempt(key, { at: startedAt, retryAt: Math.max(startedAt + 60, failure.retryAt ?? now() + 60) });
        return cached ? dataFromCache(failure) : emptyProduct(coverage, failure);
      }
      const rows = collected.map(row => ({ t: new Date(row.time * 1000).toISOString().slice(0, 16).replace('T', ' '), v: String(row.heightMeters), ...('type' in row ? { type: row.type } : {}) }));
      const normalized = interval === '6' ? normalizePredictions({ predictions: rows }, '6') : normalizePredictions({ predictions: rows }, 'hilo');
      if (!normalized.ok) {
        const error: NoaaError = { code: 'invalidProduct', message: normalized.message, retryAt: now() + 60 };
        recordAttempt(key, { at: startedAt, retryAt: error.retryAt! });
        return cached ? dataFromCache(error) : emptyProduct(coverage, error);
      }
      const fetchedAt = now();
      const data = normalized.data.filter(row => row.time >= coverage.start && row.time <= coverage.end);
      save(key, { ...coverage, data, fetchedAt });
      return { status: 'fresh', data, fetchedAt, coverage, error: null };
    })();
    inFlight.set(key, operation);
    try { return await operation; }
    finally { inFlight.delete(key); }
  }

  async function getPredictions(request: PredictionRequest): Promise<Predictions> {
    const curveSource: CurveSource = request.curveSupported === false ? 'estimatedExtremes' : 'sixMinute';
    const result = { stationId: request.stationId, timeZoneId: request.timeZoneId, datum: 'MLLW' as const, units: 'metric' as const, curveSource };
    let error: NoaaError | null = null;
    if (!validStationId(request.stationId) || !Number.isSafeInteger(request.start) || !Number.isSafeInteger(request.end) || Math.abs(request.start) > 8e12 || Math.abs(request.end) > 8e12 || request.end <= request.start || request.end - request.start > 366 * 86400) {
      error = { code: 'invalidRequest', message: 'A NOAA station and valid prediction window are required.' };
    } else if (!validTimeZone(request.timeZoneId)) {
      error = { code: 'timeZoneUnavailable', message: 'The station has no valid IANA time zone.' };
    }
    if (error) return { ...result, curve: snapshotProduct(emptyProduct<TideSample>(request, error)), events: snapshotProduct(emptyProduct<TideEvent>(request, error)) };
    const [curve, events] = await Promise.all([
      request.curveSupported === false ? Promise.resolve(emptyProduct<TideSample>(request, { code: 'curveUnavailable', message: 'NOAA supplies high/low predictions only; a display curve may be estimated from those extremes.' }, true)) : loadProduct(request, '6'),
      loadProduct(request, 'hilo'),
    ]);
    return { ...result, curve: snapshotProduct(curve as PredictionProduct<TideSample>), events: snapshotProduct(events as PredictionProduct<TideEvent>) };
  }
  return { getPredictions };
}
