import { find, setCache } from 'geo-tz';

/** LRU bounds retained boundary data; geo-tz's default cache is unbounded. */
export class BoundedZoneCache extends Map<string, unknown> {
  private readonly weights = new Map<string, number>();
  private bytes = 0;
  constructor(readonly maxEntries = 4, readonly maxBytes = 8 * 1024 * 1024) {
    super();
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid geographic cache limits.');
  }
  override get(key: string): unknown {
    const value = super.get(key);
    if (super.has(key)) { super.delete(key); super.set(key, value); }
    return value;
  }
  override set(key: string, value: unknown): this {
    this.delete(key);
    let bytes: number;
    try { bytes = (JSON.stringify(value)?.length ?? 0) * 2; } catch { return this; }
    // An oversized region can be used for this lookup without being retained.
    if (bytes > this.maxBytes) return this;
    super.set(key, value); this.weights.set(key, bytes); this.bytes += bytes;
    while (this.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.keys().next().value!);
    return this;
  }
  override delete(key: string): boolean {
    this.bytes -= this.weights.get(key) ?? 0;
    this.weights.delete(key);
    return super.delete(key);
  }
  override clear(): void { super.clear(); this.weights.clear(); this.bytes = 0; }
  stats() { return { entries: this.size, estimatedBytes: this.bytes, maxEntries: this.maxEntries, maxBytes: this.maxBytes }; }
}

const cache = new BoundedZoneCache();
setCache({ preload: false, store: cache });

/** Server only. Geographic candidates are subsequently checked against NOAA metadata. */
export function lookupStationZones(latitude: number, longitude: number): string[] { return find(latitude, longitude); }
export function stationZoneCacheStats() { return cache.stats(); }
