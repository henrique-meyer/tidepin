import { describe, expect, it } from 'vitest';
import { clearLocation, LOCATION_STORAGE_KEY, markReturnToDisplay, readLocation, RETURN_TO_DISPLAY_KEY, saveLocation, takeReturnToDisplay, type LocationStore, type SavedLocation } from '../src/client/location-settings.js';
import { currentPosition } from '../src/client/geolocation.js';

function memoryStore() {
  const values = new Map<string, string>();
  const store: LocationStore = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  return { store, values };
}
const location = { latitude: 40.12345678, longitude: -74.98765432, stationId: '0012345' };

describe('coordinate/station-only location persistence', () => {
  it('writes an explicit safe shape, preserving leading station zeros and excluding place/search fields', () => {
    const { store, values } = memoryStore();
    saveLocation({ ...location, name: 'Private address', search: 'Private query', address: 'Private address' } as SavedLocation, store);
    expect(JSON.parse(values.get(LOCATION_STORAGE_KEY)!)).toEqual({ latitude: 40.123457, longitude: -74.987654, stationId: '0012345' });
    expect(readLocation(store)).toEqual({ latitude: 40.123457, longitude: -74.987654, stationId: '0012345' });
    expect(values.size).toBe(1);
  });
  it('rejects malformed stored values without coercing coordinates and strips historical extra fields', () => {
    const { store } = memoryStore();
    for (const raw of ['broken', 'null', '{}', JSON.stringify({ ...location, latitude: '40' }), JSON.stringify({ ...location, longitude: 181 }), JSON.stringify({ ...location, stationId: 1234567 })]) {
      store.setItem(LOCATION_STORAGE_KEY, raw); expect(readLocation(store)).toBeUndefined();
    }
    store.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ ...location, name: 'Not retained by read' }));
    expect(Object.keys(readLocation(store)!)).toEqual(['latitude', 'longitude', 'stationId']);
  });
  it('fails an invalid save and reports blocked storage instead of pretending it was saved', () => {
    const { store, values } = memoryStore();
    expect(() => saveLocation({ ...location, latitude: Infinity }, store)).toThrow();
    expect(() => saveLocation({ ...location, stationId: '../secret' }, store)).toThrow();
    expect(values.size).toBe(0);
    const blocked: LocationStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readLocation(blocked)).toBeUndefined();
    expect(() => saveLocation(location, blocked)).toThrow('blocked');
    expect(() => clearLocation(blocked)).not.toThrow();
    expect(takeReturnToDisplay(blocked)).toBe(false);
  });
  it('keeps the one-shot display return marker separate from saved coordinates', () => {
    const local = memoryStore(); const session = memoryStore();
    saveLocation(location, local.store); markReturnToDisplay(session.store);
    expect(session.values.get(RETURN_TO_DISPLAY_KEY)).toBe('1');
    expect(takeReturnToDisplay(session.store)).toBe(true);
    expect(takeReturnToDisplay(session.store)).toBe(false);
    expect(local.values.has(RETURN_TO_DISPLAY_KEY)).toBe(false);
    clearLocation(local.store); expect(readLocation(local.store)).toBeUndefined();
  });
  it('preserves NOAA alphanumeric prediction IDs such as subordinate TEC stations', () => {
    const { store } = memoryStore();
    expect(saveLocation({ ...location, stationId: 'TEC1603' }, store).stationId).toBe('TEC1603');
    expect(readLocation(store)?.stationId).toBe('TEC1603');
  });
});

describe('browser geolocation adapter', () => {
  it('returns only finite in-range coordinates, not other position details', async () => {
    const geolocation = { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 40, longitude: -74, accuracy: 1, altitude: 2, heading: 3 }, timestamp: 4 } as GeolocationPosition) };
    expect(await currentPosition(geolocation)).toEqual({ latitude: 40, longitude: -74 });
  });
  it('settles permission/time-out failures, missing APIs and invalid coordinates', async () => {
    expect(await currentPosition(undefined)).toBeUndefined();
    expect(await currentPosition({ getCurrentPosition: (_success, error) => error?.({ code: 1 } as GeolocationPositionError) })).toBeUndefined();
    expect(await currentPosition({ getCurrentPosition: success => success({ coords: { latitude: 100, longitude: 0 } } as GeolocationPosition) })).toBeUndefined();
  });
});
