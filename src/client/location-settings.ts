import { validStationId } from '../shared/stations.js';
export interface Coordinates { latitude: number; longitude: number }
export interface SavedLocation extends Coordinates { stationId: string }
export type LocationStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const LOCATION_STORAGE_KEY = 'tidepin.location';
export const RETURN_TO_DISPLAY_KEY = 'tidepin.returnToDisplay';

function browserStore(kind: 'localStorage' | 'sessionStorage'): LocationStore | undefined {
  try { return typeof window === 'undefined' ? undefined : window[kind]; }
  catch { return undefined; }
}

export function isValidCoordinates(value: Coordinates): boolean {
  return typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

/** Only the pin coordinates and station identifier survive reloads. */
export function readLocation(store: LocationStore | undefined = browserStore('localStorage')): SavedLocation | undefined {
  try {
    const raw = store?.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return undefined;
    const record = value as SavedLocation;
    if (!isValidCoordinates(record) || !validStationId(record.stationId)) return undefined;
    return { latitude: record.latitude, longitude: record.longitude, stationId: record.stationId };
  } catch { return undefined; }
}

/** Construct field by field: caller-owned place names, addresses and queries never enter storage. */
export function saveLocation(location: SavedLocation, store: LocationStore | undefined = browserStore('localStorage')): SavedLocation {
  if (!isValidCoordinates(location) || !validStationId(location.stationId)) throw new Error('Choose a valid point and NOAA station.');
  if (!store) throw new Error('Device storage is unavailable.');
  const round = (coordinate: number) => Math.round(coordinate * 1e6) / 1e6;
  const saved = { latitude: round(location.latitude), longitude: round(location.longitude), stationId: location.stationId };
  store.setItem(LOCATION_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}

export function clearLocation(store: LocationStore | undefined = browserStore('localStorage')): void {
  try { store?.removeItem(LOCATION_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
}

export function markReturnToDisplay(store: LocationStore | undefined = browserStore('sessionStorage')): void {
  try { store?.setItem(RETURN_TO_DISPLAY_KEY, '1'); } catch { /* Returning still works without automatic start. */ }
}

export function takeReturnToDisplay(store: LocationStore | undefined = browserStore('sessionStorage')): boolean {
  try {
    const returning = store?.getItem(RETURN_TO_DISPLAY_KEY) === '1';
    store?.removeItem(RETURN_TO_DISPLAY_KEY);
    return returning;
  } catch { return false; }
}
