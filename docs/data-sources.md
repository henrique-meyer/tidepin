# Tide prediction data

Tide predictions: [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/). **Not for navigation.** These are predicted heights relative to Mean Lower Low Water (MLLW), not observed water levels.

## Requests and normalization

The server-side client uses NOAA's public [Data Retrieval API](https://api.tidesandcurrents.noaa.gov/api/prod/) at `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`. No API key is required. Each request specifies `product=predictions`, `datum=MLLW`, `units=metric`, `time_zone=gmt`, `format=json`, `application=Tidepin`, a station ID and explicit UTC bounds. Separate requests retrieve the six-minute curve (`interval=6`) and authoritative high/low events (`interval=hilo`). High/low-only stations are supported without synthesizing a curve.

Curve coverage includes one six-minute sample before/after the display window. Events include 24 elapsed hours before/after it for lookahead across midnight. Requests longer than thirty elapsed days are split, retaining a shared boundary sample. Every row is validated; identical duplicates collapse and conflicting duplicates invalidate the complete product. An empty predictions array is valid. HTTP failures, malformed JSON and NOAA's HTTP-200 error envelopes produce typed failures.

Canonical time is UTC Unix seconds and canonical height is signed finite meters. A caller supplies the station's validated IANA zone, never a device zone or guessed fixed offset. `stationDayWindow` computes local calendar boundaries (including DST) and `formatStationTime` includes station-zone/UTC-offset labels. NOAA remains the only tide-data source.

## Station discovery and local time

The location picker resolves its chosen coordinates against NOAA's [Metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/), using `stations.json?type=tidepredictions`. Great-circle distance chooses the nearest station, including across the date line. Reference (`R`) and subordinate (`S`) prediction stations are included; subordinate stations expose high/low predictions without an invented sampled curve. IDs are seven-character ASCII alphanumeric strings, including NOAA's `TEC` identifiers; leading zeros and case are preserved. The prediction client shares this validation, so a catalog-selected `TEC` station can request its events; malformed and traversal-like IDs are rejected before network access.

Catalog and station-detail metadata are cached in process memory for seven days, with coalescing, one-second request pacing and failure backoff. No user coordinates, addresses or query strings are persisted on the server. A geographic IANA lookup uses the station's public coordinates and cross-checks NOAA standard-offset/DST metadata. Ambiguous or inconsistent zones remain unavailable. Longitude-based `Etc/GMT*` ocean fallback zones are also unavailable, including when a subordinate station omits its DST flag; matching a numeric offset alone is insufficient. See [ADR 0004](decisions/0004-station-time-zones.md) for the server-only dependency, bounded cache and measured size/memory tradeoff, and [third-party notices](third-party-notices.md) for boundary-data attribution.

## Cache and failure behavior

The in-memory cache separates station, datum, units, interval, schema and coverage. Its default freshness window is six hours and expires at equality; deployments can choose a shorter TTL through client construction. Superset coverage is reused, identical in-flight requests coalesce, and requests start serially at least one second apart. Each caller receives its own arrays, rows, coverage and error objects: changing a returned result cannot corrupt cache contents or another caller's result. Manual refresh bypasses freshness but keeps the minimum sixty-second attempt interval. Failures honor longer `Retry-After` values and retain the last independently valid product as saved data. Without coverage the product returns a typed error and `null` data, never invented tides. Cache and attempt bookkeeping are bounded; nothing is persisted to disk.

## Chart computations and verification

The pure shared module interpolates only across adjacent samples at most 360 seconds apart. It never extrapolates or bridges missing samples. Chart endpoints are inclusive to close the drawing; selected-day event markers are end-exclusive. Next events include an event exactly at the current instant. The now marker uses actual interpolation and appears only on today's covered chart. Horizontal position uses elapsed UTC seconds, so a DST day retains its real 23/25-hour width. Feet use `meters / 0.3048`; display-only rounding uses one decimal with ties away from zero.

`test/fixtures/tides.json` contains synthetic, frozen NOAA-shaped input and expected canonical results. Tests exercise normalization, gaps, boundaries, exact-event equality, negative heights, DST days/weeks, station-vs-device dates, caching, concurrency, rate limits and offline failures. Tests use injected clocks/network responses, with no live NOAA dependency. The client and pure module are ready for integration; the initial scaffold page does not yet fetch or render them.
