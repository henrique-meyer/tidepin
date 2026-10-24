import type { TideEvent, TideSample, TideWindow } from './tides.js';
import type { TideStation } from './stations.js';

export interface NoaaError {
  code: 'invalidRequest' | 'timeZoneUnavailable' | 'http' | 'network' | 'invalidProduct' | 'throttled' | 'curveUnavailable';
  message: string;
  retryAt?: number;
}
export interface PredictionProduct<T> {
  status: 'fresh' | 'saved' | 'error' | 'unsupported';
  data: T[] | null;
  fetchedAt: number | null;
  coverage: TideWindow;
  error: NoaaError | null;
}
export interface Predictions {
  stationId: string;
  timeZoneId: string;
  datum: 'MLLW';
  units: 'metric';
  curve: PredictionProduct<TideSample>;
  events: PredictionProduct<TideEvent>;
}

export interface TideResponse { station: TideStation; window: TideWindow; now: number; predictions: Predictions }
