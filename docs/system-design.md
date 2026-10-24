# System design

The demo is one stateless Node 24 process with a browser client. This document describes the scaffold and prediction-data modules; application screens and HTTP integration arrive through later tasks.

## Request flow

In production, Fastify listens on `0.0.0.0` at `PORT` (8080 by default). `GET /health` returns `{"status":"ok"}` without depending on an upstream data source. The compiled Vite page and bundles come from `dist/client`; unchanged brand assets come from `assets` under the `/assets/` URL prefix. Unrecognized paths return 404. SIGINT and SIGTERM close the HTTP server gracefully.

In development, Vite serves the client on port 5173 and proxies `/health`, `/api`, and `/assets` to Fastify on port 8080. The server starts without a compiled client, so the health endpoint and original logo remain available while Vite handles the page.

The location picker is a separate Vite HTML entry. Both development and production serve it at `/location`; production Fastify sends `location.html` explicitly. `GET /api/config` returns only browser-safe Maps settings and the demo session limit with `Cache-Control: no-store`. A browser-restricted Maps key is supplied at runtime and never embedded in the build. `POST /api/stations/nearest` accepts only numeric coordinates, and `GET /api/stations/:id` restores public station metadata without persisting its name.

## Modules and build

`src/server/app.ts` creates a Fastify instance without opening a socket, allowing request-level tests with Fastify injection. `config.ts` validates the process port, and `index.ts` supplies production asset paths and starts the process. `src/client` is plain TypeScript plus CSS. Vitest runs the tests in `test`; ESLint and TypeScript check the complete source tree.

`src/server/noaa-client.ts` provides `createNoaaClient().getPredictions()` for a station ID, validated IANA zone and UTC display window. Separate curve/event requests normalize canonical UTC seconds and meters. Its bounded in-memory cache reuses covered windows, coalesces identical in-flight requests and retains independently valid saved products after errors. Downloads are serialized with one-second pacing; retries respect a sixty-second minimum and longer NOAA retry instructions. These modules are not yet exposed by a browser route.

`src/shared/tides.ts` holds pure normalization, six-minute-limited interpolation, segmented chart points, separate day markers and next events, station-local calendar windows and unit/time formatting. Chart coordinates use elapsed seconds; canonical meters remain unchanged. A supplied IANA zone governs station dates, including DST, while requests use GMT to avoid ambiguous timestamps. See [data sources](data-sources.md) for the API contract, cache behavior and deterministic fixtures.

The page has a semantic three-line footer: linked NOAA CO-OPS credit, a separate navigation disclaimer and the personal/source credit. External links open in a new tab with `rel="noopener"`. Its isolated `footer.css` uses the source-credit typography/color tokens and allows wrapping on narrow screens; the main placeholder content remains separate from the footer. A flexible main row keeps the footer at the bottom without fixing it over future chart content.

The container has a build stage and a runtime stage based on `node:24-slim`. Its runtime contains production dependencies, compiled output, original brand assets and the project license with its required notice, and runs as the unprivileged `node` user. Local configuration, notes, tests and infrastructure files are excluded from the container context. The project is source-available for noncommercial use; see [the license terms and branding restrictions](../README.md#license). Third-party components retain their separate terms.

## Appearance

The browser follows the system's light or dark appearance through `prefers-color-scheme`; changes take effect immediately without a reload or a stored theme preference. CSS custom properties use the Tidepin source design tokens for colors, chart colors, typography, spacing, radii and motion. Text uses system fonts with the source iOS type-role sizes in rem, so browser font scaling continues to work. Later components reuse these properties rather than inventing values.

Links use the accessible accent-text color rather than brand amber on the light background. `prefers-contrast: more` promotes secondary/tertiary text to primary and decorative separators to the border color. `prefers-reduced-motion` makes the token durations instantaneous. The page uses flat surfaces; there is no animated backdrop or audio.

## State and privacy

Location selection stores exactly `{latitude, longitude, stationId}` in the device's `tidepin.location` record. Names are reloaded from NOAA, never persisted. Place search uses Google Places API (New), with debouncing and session tokens; address/query text and suggestions stay only in page memory and are cleared after selection or page exit. Search text is sent directly to Google rather than through the app server. User-coordinate requests use a POST body and request logging is disabled. The server's metadata and prediction caches are bounded process memory, with no database or user-location history.

The picker supports map clicks, a draggable pin and browser geolocation. Save marks a transient, one-shot session return flag and navigates to the display; failure to write device storage keeps the user on the picker with an explanation. Back marks the same return flag without saving a changed pin. A generation guard prevents slow station/search responses from replacing a more recent selection. Missing Maps configuration yields a readable map state and keeps current-location selection available; this does not count as live Maps verification. Secrets and environment-specific values belong in private configuration; `.env.example` documents safe settings for local development.

Place search supports keyboard selection: arrow keys wrap through suggestions, with ArrowUp entering an unselected list at its last item and ArrowDown at its first. Enter chooses the highlighted result; Escape clears the transient query and list.

## Display controls and preferences

`src/client/controls.ts` exports `mountTopBar(root, options)`, returning `setLocationName(name)` and `destroy()`. It mounts the original-logo brand, Settings, Location and an explicitly requested full-screen action. The Settings dialog contains only height units (feet/meters), a 12/24-hour clock and Reset, plus Done to close it. Changes apply immediately. Reset restores feet and the source 12-hour default while preserving the chosen location. Native modal behavior handles keyboard focus and Escape. When full screen is entered through the button or browser display mode, the action buttons hide as in the source display; exiting restores them. Unsupported full screen is hidden, and a rejected request is harmless. The start-screen integration decides when its top-bar root is visible.

`src/client/display-settings.ts` owns the shared `tidepin.display` preference key and the typed `DisplaySettings` contract: `{ heightUnit: 'ft' | 'm', clockFormat: '12h' | '24h' }`. Read/get, partial set/update, reset and subscribe functions are shared by controls and future display consumers. Storage is optional: blocked site data leaves a working in-memory preference for the current visit. Malformed data falls back to valid defaults; unknown fields are never written. Returned snapshots are independent, and cross-tab storage changes refresh live subscribers. The injectable store allows deterministic tests without a browser.

**Height integration contract:** every shown tide height uses the same current `heightUnit`, including the current height, next high, next low, chart axis and accessible descriptions. Consumers use the existing pure `formatHeight(canonicalMeters, settings.heightUnit)` / `heightInUnit` helpers, retain canonical meters unchanged and redraw on preference changes. The clock preference supplies `settings.clockFormat === '12h'` to `formatStationTime`, preserving the station's IANA time zone. There is no separate distance-unit preference or duplicated unit state in the location picker. The graph integration implements these display bindings in its own task.

## Infrastructure and verification

`infra/main.bicep` describes a Consumption Container Apps environment, capped Log Analytics workspace, and optional app, GitHub OIDC deploy identity and monthly budget. Resource names and environment values are parameters. The app allocation is fixed at 0.25 vCPU and 0.5 GiB, scales from zero to at most one replica, and requires HTTPS ingress. Startup, readiness and liveness probes all request the process-health endpoint. The deploy identity reads the resource group and can modify only this app; applying infrastructure requires separate provisioning permissions. Verified hostname and certificate parameters retain the custom-domain binding; the dashboard includes the referenced managed certificate alongside the resources it creates. Certificate issuance is a separate provider operation after owner-managed DNS validation. The private runbook records live endpoints and verification evidence; the public template contains none of those values.

`.github/workflows/pr.yml` checks each PR's exact head: lint, TypeScript, tests and production build, Bicep and example-parameter compilation, then Docker build and a live health/non-root check. These checks require no cloud credentials. The safe parameter example is not deployable until an operator supplies private values.

`.github/workflows/deploy.yml` publishes a GHCR image on `main` and uses the production environment's OIDC identity to update the existing app to its immutable commit tag. The first run publishes without a rollout until all required environment secrets exist. The workflow checks both revision health and the process-health response, including waking scale-to-zero revisions, and serializes rollouts. Resource and generated endpoint details are masked in public logs. Infrastructure provisioning stays separate from app updates. The Bicep template also creates a shared resource dashboard when configured; see the [infrastructure guide](../infra/README.md).

See [ADR 0001](decisions/0001-hosting.md) for hosting and [ADR 0002](decisions/0002-stack.md) for the stack. NOAA CO-OPS is the sole tide-data source; predictions are not for navigation.
