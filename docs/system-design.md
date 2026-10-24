# System design

The demo is one stateless Node 24 process with a browser client. This document describes the scaffold and prediction-data modules; application screens and HTTP integration arrive through later tasks.

## Request flow

In production, Fastify listens on `0.0.0.0` at `PORT` (8080 by default). `GET /health` returns `{"status":"ok"}` without depending on an upstream data source. The compiled Vite page and bundles come from `dist/client`; unchanged brand assets come from `assets` under the `/assets/` URL prefix. Unrecognized paths return 404. SIGINT and SIGTERM close the HTTP server gracefully.

In development, Vite serves the client on port 5173 and proxies `/health`, `/api`, and `/assets` to Fastify on port 8080. The server starts without a compiled client, so the health endpoint and original logo remain available while Vite handles the page.

## Modules and build

`src/server/app.ts` creates a Fastify instance without opening a socket, allowing request-level tests with Fastify injection. `config.ts` validates the process port, and `index.ts` supplies production asset paths and starts the process. `src/client` is plain TypeScript plus CSS. Vitest runs the tests in `test`; ESLint and TypeScript check the complete source tree.

`src/server/noaa-client.ts` provides `createNoaaClient().getPredictions()` for a station ID, validated IANA zone and UTC display window. Separate curve/event requests normalize canonical UTC seconds and meters. Its bounded in-memory cache reuses covered windows, coalesces identical in-flight requests and retains independently valid saved products after errors. Downloads are serialized with one-second pacing; retries respect a sixty-second minimum and longer NOAA retry instructions. These modules are not yet exposed by a browser route.

`src/shared/tides.ts` holds pure normalization, six-minute-limited interpolation, segmented chart points, separate day markers and next events, station-local calendar windows and unit/time formatting. Chart coordinates use elapsed seconds; canonical meters remain unchanged. A supplied IANA zone governs station dates, including DST, while requests use GMT to avoid ambiguous timestamps. See [data sources](data-sources.md) for the API contract, cache behavior and deterministic fixtures.

The container has a build stage and a runtime stage based on `node:24-slim`. Its runtime contains production dependencies, compiled output and original brand assets, and runs as the unprivileged `node` user. Local configuration, notes, tests and infrastructure files are excluded from the container context.

## State and privacy

The initial page has no persistence, user input, analytics or location storage. Its prediction client makes upstream requests only when called, and stores predictions only in bounded process memory. Request logging is disabled so future location search URLs do not enter logs. Later location features may retain only coordinates and station identifiers, never addresses or search text. Secrets and environment-specific values belong in private configuration; `.env.example` documents safe settings for local development.

## Infrastructure and verification

`infra/main.bicep` describes a Consumption Container Apps environment, capped Log Analytics workspace, and optional app, GitHub OIDC deploy identity and monthly budget. Resource names and environment values are parameters. The app allocation is fixed at 0.25 vCPU and 0.5 GiB, scales from zero to at most one replica, and requires HTTPS ingress. Startup, readiness and liveness probes all request the process-health endpoint. The deploy identity reads the resource group and can modify only this app; applying infrastructure requires separate provisioning permissions. Existing verified hostname and certificate parameters retain a later custom-domain binding.

`.github/workflows/pr.yml` checks each PR's exact head: lint, TypeScript, tests and production build, Bicep and example-parameter compilation, then Docker build and a live health/non-root check. These checks require no cloud credentials. The safe parameter example is not deployable until an operator supplies private values. No resources or deploy workflow are created by this change; see the [infrastructure guide](../infra/README.md) for the later provisioning sequence.

See [ADR 0001](decisions/0001-hosting.md) for hosting and [ADR 0002](decisions/0002-stack.md) for the stack. NOAA CO-OPS is the sole tide-data source; predictions are not for navigation.
