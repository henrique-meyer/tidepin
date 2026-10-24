# Tidepin

A web demo for viewing NOAA CO-OPS tide predictions. The Start display flow, location picker and shared display controls are implemented; tide graph rendering follows in its own task.

[Tide predictions: NOAA CO-OPS (tidesandcurrents.noaa.gov)](https://tidesandcurrents.noaa.gov). **Not for navigation.**

Designed & built by Henrique Meyer · [Source on GitHub](https://github.com/henrique-meyer/tidepin)

## Start the display

Open the main page and press **Start display** to use a saved station. A first visit offers browser location or **Set location** for the map picker. The selected coordinates resolve to the nearest NOAA prediction station; the saved selection is reused without another browser-location request. Returning from the picker opens the display directly once.

The shell shows the chosen station and its controls, with a separate mount for the upcoming tide graph. The footer shows **Session expires: H:mm** during a display session. `SESSION_LIMIT_MINUTES` accepts 1–120 minutes and defaults to 120. Expiry returns to Start with **Your session has ended. Press Start display to continue.** Press Start again for a fresh session with the same station. The NOAA credit, navigation disclaimer and source credit remain visible on both screens. The client timer stops ordinary graph work through the session-ended event; it is a cooperative demo limit rather than a server quota. See [ADR 0003](docs/decisions/0003-demo-session.md).

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

The page footer combines the NOAA source link and “Not for navigation.” in one paragraph: “Tide predictions: NOAA CO-OPS (tidesandcurrents.noaa.gov). Not for navigation.” The personal/source credit stays separate. Its external links open in a new tab with `rel="noopener"`. The paragraph wraps naturally on narrow screens and uses the Tidepin footnote and color tokens on the Start, display and location pages.

## License

Tidepin Demo is source-available for noncommercial use under [PolyForm-Noncommercial-1.0.0](LICENSE). This is not an OSI-approved license. Commercial use requires permission from the author.

The Tidepin name, logos and artwork are not licensed for reuse. Third-party dependencies and data retain their own licenses and notices; the project license does not replace those terms.
