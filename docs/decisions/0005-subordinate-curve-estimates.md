# ADR 0005: Explicit estimates for subordinate tide curves

Status: Accepted for implementation in TIDEDEMO-22.

## Context

The nearest NOAA prediction station may be a subordinate station. NOAA's [Data Retrieval API](https://api.tidesandcurrents.noaa.gov/api/prod/) supports only high/low predictions at those stations. Showing only the extremes left the daily graph, current-height card and ocean level unavailable even when useful prediction data existed.

## Decision

Retain the selected station and NOAA's real predicted extremes. In the existing pure chart module, explicitly select an `estimatedExtremes` source for subordinate stations. For each consecutive pair, evaluate a half-cosine between its times and heights. Include exact extrema, chart boundaries covered by a pair and six-minute drawing points. Evaluate the current height at the exact current instant using the same function. Share that canonical result with the graph and ocean.

Request high/low predictions with 24 elapsed hours of padding on each side of the station-local day. This brackets the chart edges for ordinary daily tide cycles, including 23/25-hour DST days. If brackets are absent, do not extrapolate. One extreme can supply its exact point but cannot define a segment. Empty or failed predictions retain explicit empty/error states and retry behavior.

The curve caption says “Curve estimated from predicted highs and lows.” The current-height card says “Estimated height now”; accessible descriptions identify the estimate too. Next high/low cards, markers and table always use the original predicted events. The picker explains the station's estimated-curve capability. Harmonic stations retain their existing six-minute samples and gap rules; upstream failures do not trigger this approximation.

## Consequences and verification

This approximation is smooth and monotonic between consecutive extremes, with a flat slope and exact value at each endpoint. It cannot reproduce all local tidal shape, compound tides, weather effects or observed water levels. NOAA remains the only tide source. Keep “Not for navigation.” and distinguish app estimates from NOAA sampled predictions.

Unit tests cover endpoint equality, monotonicity, exact-time current values, window boundaries, isolated extremes and DST. Separate live acceptance covers multiple subordinate stations plus an unchanged harmonic station; visual/data changes require independent review before merge. No extra tide source, coordinate storage or prediction request cadence is introduced.
