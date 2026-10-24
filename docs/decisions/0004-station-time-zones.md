# ADR 0004: Geographic station time zones

## Status

Accepted, 2026-10-24.

## Context

NOAA prediction stations expose a standard UTC offset and, where available, a daylight-saving flag. Neither an offset nor an abbreviation alone identifies the IANA rules needed for station-local dates and DST. A station can remain discoverable even when its local time cannot be validated.

## Decision

Use the exact geographic lookup in [`geo-tz` 8.1.10](https://github.com/evansiroky/node-geo-tz), only on the server. Its default boundaries group zones with matching timekeeping since 1970, which covers this current-day demo. Compare geographic candidates with NOAA's standard offset and its daylight-saving flag when supplied. Exactly one consistent candidate is required; missing, ambiguous or inconsistent results become `timeZoneId: null`, never the device zone or guessed UTC.

The installed package includes approximately 71 MiB of boundary data across its products. This increases image size, rather than the browser download. Keep the package's data and license files intact in the runtime dependency directory. Do not preload it. Replace its unbounded feature cache with a four-entry LRU, capped at 8 MiB of estimated serialized data; oversized regions can be read for one lookup without being retained. This bounds retained geometry, not the total Node process or transient decoder allocations.

NOAA catalog data refreshes after seven elapsed days. Coalesce identical metadata requests, pace starts at least one second apart and back off failed refreshes while preserving valid cached metadata. Geographic lookup is offline and makes no additional service requests. Only a station's public coordinates enter it; user location is used only to select the nearest NOAA prediction station.

## Alternatives

An unmaintained lookup with old boundaries risks incorrect modern zones. Smaller approximate lookup libraries explicitly trade accuracy for size and can return the wrong offset or DST rules near coasts/borders. A paid remote time-zone service adds credentials, latency and location disclosure. An offset-only mapping fails the station-local DST contract.

## Validation and consequences

Deterministic tests cover representative mainland, Alaska, Hawaii and territory stations, NOAA offset/DST conflicts, ambiguity and LRU eviction/size bounds. One local live-data smoke covered seven stations, including an alphanumeric subordinate station: process RSS grew from about 54 MiB to 67 MiB, with two retained regions using approximately 13 KiB of serialized weight. An indexed New York lookup took about 2.2 ms for 1,000 calls in a separate local sample. These are observations, not a memory or latency guarantee for every boundary. Deployment health still requires its own verification.

The library code is MIT-licensed; geographic boundaries come from timezone-boundary-builder/OpenStreetMap under ODbL 1.0. Preserve notices and attribution in [third-party notices](../third-party-notices.md). Review upstream boundary and IANA/Node data updates together when a station-zone mismatch is reported.
