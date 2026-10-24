import { describe, expect, it } from 'vitest';
import { BoundedZoneCache, lookupStationZones, stationZoneCacheStats } from '../src/server/station-zones.js';

describe('server geographic station-zone lookup', () => {
  it.each([
    [40.700553894, -74.014167786, 'America/New_York'],
    [37.806305556, -122.465888889, 'America/Los_Angeles'],
    [21.303333333, -157.864527778, 'Pacific/Honolulu'],
    [18.458944444, -66.116416667, 'America/Puerto_Rico'],
    [13.443388889, 144.656361111, 'Pacific/Guam'],
    [61.2375, -149.890388889, 'America/Anchorage'],
  ])('resolves the representative NOAA station at %s,%s', (latitude, longitude, zone) => {
    expect(lookupStationZones(latitude, longitude)).toContain(zone);
    expect(stationZoneCacheStats().entries).toBeLessThanOrEqual(4);
    expect(stationZoneCacheStats().estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
  it('evicts least recently used regions and never retains an oversized region', () => {
    const cache = new BoundedZoneCache(2, 100);
    cache.set('a', { data: 'x'.repeat(10) }); cache.set('b', { data: 'y'.repeat(10) });
    cache.get('a'); cache.set('c', { data: 'z'.repeat(10) });
    expect(cache.has('a')).toBe(true); expect(cache.has('b')).toBe(false); expect(cache.has('c')).toBe(true);
    cache.set('oversized', 'x'.repeat(100)); expect(cache.has('oversized')).toBe(false);
    expect(cache.stats().estimatedBytes).toBeLessThanOrEqual(100);
    cache.clear(); expect(cache.stats().estimatedBytes).toBe(0);
    expect(() => new BoundedZoneCache(0, 100)).toThrow(RangeError);
  });
});
