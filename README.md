# Tidepin

A web demo for viewing NOAA CO-OPS tide predictions. The initial scaffold contains a Tidepin logo placeholder and a process-health endpoint; the tide graph and application screens follow in separate tasks.

[Tide predictions: NOAA CO-OPS (tidesandcurrents.noaa.gov)](https://tidesandcurrents.noaa.gov)

**Predictions only. Not for navigation.**

Designed & built by Henrique Meyer · [Source on GitHub](https://github.com/henrique-meyer/tidepin)

## Run locally

Use Node 24 or newer:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The Fastify server listens on port 8080 and serves `GET /health` as `{"status":"ok"}`. `PORT` may be changed in `.env`; when changing it for development, update the matching Vite proxy target too.

## Choose a location

Open `/location` to choose a map pin, search for a place or use the browser's current location. The point resolves to the nearest NOAA prediction station. Save returns to the display. Only coordinates and the station identifier are saved on the device; addresses, search text and station names are not persisted.

Maps requires a browser-restricted Google Maps key supplied as `GOOGLE_MAPS_API_KEY` at runtime. Enable Maps JavaScript API and Places API (New), restrict it to your actual HTTPS site referrers, and authorize any local test referrer explicitly. `GOOGLE_MAPS_MAP_ID` is optional; the public Google demo map is the default for the draggable advanced marker. Keep actual keys in private configuration and out of tracked files. Without a key the page explains the unavailable map, and browser current-location selection can still resolve a NOAA station. This fallback does not verify a live Google map.

Station-local time uses a server-only geographic lookup checked against NOAA metadata. See [data sources](docs/data-sources.md), [ADR 0004](docs/decisions/0004-station-time-zones.md) and [third-party notices](docs/third-party-notices.md).

## Check and build

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

After building, open `http://localhost:8080`. `npm start` reads `PORT` from the process environment; the `.env` file is loaded by the development script only.

## Container

```sh
docker build -t tidepin .
docker run --rm -p 8080:8080 tidepin
```

The two-stage Node 24 image runs as the non-root `node` user and exposes port 8080. Pass an explicit `PORT` using `-e PORT=8080` if the hosting platform requires it. The process is stateless.

## Project layout

`src/server` holds Fastify and the NOAA predictions client, `src/client` holds the Vite page, `src/shared/tides.ts` holds pure chart, interpolation and station-local time computations, `test` holds Vitest tests and frozen fixtures, and `assets` holds original brand files. The prediction modules are ready for the later browser/API integration. The layout follows the [BoltClock demo](https://github.com/henrique-meyer/boltclock).

See the [system design](docs/system-design.md), [implementation plan](docs/plan.md), [infrastructure guide](infra/README.md), and the decisions for [hosting](docs/decisions/0001-hosting.md) and [the stack](docs/decisions/0002-stack.md). Pull-request CI verifies the app, Bicep templates and a running non-root container. Parameterized infrastructure includes a shared resource dashboard; main-branch deployment publishes a container and updates the app through OIDC. Real environment values, private notes, and secrets must stay outside this public repository.

The page footer displays the NOAA source link, the navigation disclaimer on its own line and the personal/source credit above. Its external links open in a new tab with `rel="noopener"`. The footer wraps on narrow screens and uses the Tidepin footnote and color tokens; the current page content remains a placeholder for the later application screens.

## License

Tidepin Demo is source-available for noncommercial use under [PolyForm-Noncommercial-1.0.0](LICENSE). This is not an OSI-approved license. Commercial use requires permission from the author.

The Tidepin name, logos and artwork are not licensed for reuse. Third-party dependencies and data retain their own licenses and notices; the project license does not replace those terms.
