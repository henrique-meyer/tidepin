import { describe, expect, it } from 'vitest';
import {
  createDisplaySettingsStore,
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_SETTINGS_KEY,
  normalizeDisplaySettings,
  type DisplaySettings,
  type PreferenceStorage,
} from '../src/client/display-settings.js';

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('display preferences', () => {
  it('defaults to feet and the source 12-hour clock, including missing or corrupt storage', () => {
    for (const raw of [undefined, '{broken', 'null', '17', '[]', '{"heightUnit":"invalid","clockFormat":"invalid"}']) {
      const storage = memoryStorage(raw === undefined ? {} : { [DISPLAY_SETTINGS_KEY]: raw });
      expect(createDisplaySettingsStore(storage).get()).toEqual({ heightUnit: 'ft', clockFormat: '12h' });
    }
    expect(normalizeDisplaySettings(undefined)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it('loads valid fields, ignores unknown data and persists only the two display preferences', () => {
    const storage = memoryStorage({ [DISPLAY_SETTINGS_KEY]: JSON.stringify({ heightUnit: 'm', clockFormat: '24h', unrelated: 'not a preference' }) });
    const settings = createDisplaySettingsStore(storage);
    expect(settings.get()).toEqual({ heightUnit: 'm', clockFormat: '24h' });
    settings.set({ clockFormat: '12h' });
    expect(JSON.parse(storage.values.get(DISPLAY_SETTINGS_KEY)!)).toEqual({ heightUnit: 'm', clockFormat: '12h' });
    expect(createDisplaySettingsStore(storage).get()).toEqual(settings.get());
  });

  it('applies either preference independently and resets preferences without changing location or other site data', () => {
    const locationKey = 'tidepin.location';
    const location = JSON.stringify({ latitude: 1, longitude: 2, stationId: '1234567' });
    const storage = memoryStorage({ [locationKey]: location, other: 'keep' });
    const settings = createDisplaySettingsStore(storage);
    expect(settings.set({ heightUnit: 'm' })).toEqual({ heightUnit: 'm', clockFormat: '12h' });
    expect(settings.set({ clockFormat: '24h' })).toEqual({ heightUnit: 'm', clockFormat: '24h' });
    expect(settings.reset()).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(storage.values.get(locationKey)).toBe(location);
    expect(storage.values.get('other')).toBe('keep');
  });

  it('keeps changes for the current visit when storage is unavailable or rejects reads/writes', () => {
    const blocked: PreferenceStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('full'); },
    };
    for (const storage of [undefined, blocked]) {
      const settings = createDisplaySettingsStore(storage);
      expect(settings.set({ heightUnit: 'm', clockFormat: '24h' })).toEqual({ heightUnit: 'm', clockFormat: '24h' });
      settings.reload();
      expect(settings.get()).toEqual({ heightUnit: 'm', clockFormat: '24h' });
      expect(settings.reset()).toEqual(DEFAULT_DISPLAY_SETTINGS);
    }
  });

  it('notifies live consumers only on changes and stops after unsubscribe', () => {
    const storage = memoryStorage();
    const settings = createDisplaySettingsStore(storage);
    const received: DisplaySettings[] = [];
    const unsubscribe = settings.subscribe((value) => received.push(value));
    settings.set({ heightUnit: 'ft' });
    settings.set({ heightUnit: 'm' });
    settings.set({ heightUnit: 'm' });
    storage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({ heightUnit: 'm', clockFormat: '24h' }));
    settings.reload();
    unsubscribe();
    settings.reset();
    expect(received).toEqual([{ heightUnit: 'm', clockFormat: '12h' }, { heightUnit: 'm', clockFormat: '24h' }]);
  });

  it('isolates saved state from caller mutations and from a mutating subscriber', () => {
    const settings = createDisplaySettingsStore();
    settings.get().heightUnit = 'm';
    settings.subscribe((value) => { value.clockFormat = '24h'; });
    const received: DisplaySettings[] = [];
    settings.subscribe((value) => received.push(value));
    const changed = settings.set({ heightUnit: 'm' });
    changed.heightUnit = 'ft';
    expect(settings.get()).toEqual({ heightUnit: 'm', clockFormat: '12h' });
    expect(received).toEqual([{ heightUnit: 'm', clockFormat: '12h' }]);
  });
});
