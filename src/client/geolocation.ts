import type { Coordinates } from './location-settings.js';
export type { Coordinates } from './location-settings.js';

/** Browser coordinates only: no addresses, search strings, logging or persistence. */
export function currentPosition(
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
  timeoutMs = 30_000,
): Promise<Coordinates | undefined> {
  if (!geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          const { latitude, longitude } = coords;
          resolve(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
            && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
            ? { latitude, longitude } : undefined);
        },
        () => resolve(undefined),
        { timeout: timeoutMs, maximumAge: 10 * 60_000 },
      );
    } catch { resolve(undefined); }
  });
}
