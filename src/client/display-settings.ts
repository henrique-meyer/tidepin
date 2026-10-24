import type { HeightUnit } from '../shared/tides.js';

export type { HeightUnit } from '../shared/tides.js';
export type ClockFormat = '12h' | '24h';

/** Presentation only: canonical tide heights stay in meters. No location or search data lives here. */
export interface DisplaySettings {
  heightUnit: HeightUnit;
  clockFormat: ClockFormat;
}

export const DISPLAY_SETTINGS_KEY = 'tidepin.display';
export const DEFAULT_DISPLAY_SETTINGS: Readonly<DisplaySettings> = Object.freeze({ heightUnit: 'ft', clockFormat: '12h' });

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PreferencesListener = (settings: DisplaySettings) => void;

export interface DisplaySettingsStore {
  get(): DisplaySettings;
  set(patch: Partial<DisplaySettings>): DisplaySettings;
  reset(): DisplaySettings;
  subscribe(listener: PreferencesListener): () => void;
  /** Re-read a change made by another page on this origin. */
  reload(): void;
}

/** Old, malformed or hand-edited storage never introduces extra settings or invalid units. */
export function normalizeDisplaySettings(value: unknown): DisplaySettings {
  const input = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    heightUnit: input.heightUnit === 'm' ? 'm' : 'ft',
    clockFormat: input.clockFormat === '24h' ? '24h' : '12h',
  };
}

function loadSettings(storage: PreferenceStorage | undefined, fallback: Readonly<DisplaySettings> = DEFAULT_DISPLAY_SETTINGS): DisplaySettings {
  if (!storage) return { ...fallback };
  let raw: string | null;
  try {
    raw = storage.getItem(DISPLAY_SETTINGS_KEY);
  } catch {
    return { ...fallback };
  }
  try {
    return normalizeDisplaySettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

/** An injectable preference store; blocked persistence still allows changes for this visit. */
export function createDisplaySettingsStore(storage?: PreferenceStorage): DisplaySettingsStore {
  let current = loadSettings(storage);
  const listeners = new Set<PreferencesListener>();

  function apply(next: DisplaySettings, persist: boolean): DisplaySettings {
    const changed = current.heightUnit !== next.heightUnit || current.clockFormat !== next.clockFormat;
    current = { ...next };
    if (persist) {
      try {
        storage?.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(current));
      } catch {
        // Site data may be blocked or full. Keep the settings in memory for this visit.
      }
    }
    if (changed) for (const listener of listeners) listener({ ...current });
    return { ...current };
  }

  return {
    get: () => ({ ...current }),
    set: (patch) => apply(normalizeDisplaySettings({ ...current, ...patch }), true),
    reset: () => apply({ ...DEFAULT_DISPLAY_SETTINGS }, true),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reload: () => { apply(loadSettings(storage, current), false); },
  };
}

let browserStore: DisplaySettingsStore | undefined;

function defaultStore(): DisplaySettingsStore {
  if (browserStore) return browserStore;
  let storage: PreferenceStorage | undefined;
  try {
    storage = typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Accessing localStorage itself can throw, before getItem is reached.
  }
  browserStore = createDisplaySettingsStore(storage);
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === DISPLAY_SETTINGS_KEY || event.key === null) browserStore?.reload();
    });
  }
  return browserStore;
}

export function readDisplaySettings(): DisplaySettings { return defaultStore().get(); }
export const getDisplaySettings = readDisplaySettings;
export function setDisplaySettings(patch: Partial<DisplaySettings>): DisplaySettings { return defaultStore().set(patch); }
export const updateDisplaySettings = setDisplaySettings;
export function resetDisplaySettings(): DisplaySettings { return defaultStore().reset(); }
export function subscribeDisplaySettings(listener: PreferencesListener): () => void { return defaultStore().subscribe(listener); }
