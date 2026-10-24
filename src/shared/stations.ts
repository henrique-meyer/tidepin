export interface StationCoordinates { latitude: number; longitude: number }
export interface TideStation extends StationCoordinates {
  id: string;
  name: string;
  /** Null means zone validation failed; never guess the device zone or UTC. */
  timeZoneId: string | null;
  curveSupported: boolean;
}

export function validStationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{7}$/.test(value);
}

export function validStationCoordinates(point: StationCoordinates): boolean {
  return typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

/** Great-circle distance, including longitude wrap and polar points. */
export function stationDistanceMeters(a: StationCoordinates, b: StationCoordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
