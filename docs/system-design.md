# System design

The demo is one stateless Node 24 process with a browser client. This document describes the implemented scaffold; application screens and tide data arrive through later tasks.

## Request flow

In production, Fastify listens on `0.0.0.0` at `PORT` (8080 by default). `GET /health` returns `{"status":"ok"}` without depending on an upstream data source. The compiled Vite page and bundles come from `dist/client`; unchanged brand assets come from `assets` under the `/assets/` URL prefix. Unrecognized paths return 404. SIGINT and SIGTERM close the HTTP server gracefully.

In development, Vite serves the client on port 5173 and proxies `/health`, `/api`, and `/assets` to Fastify on port 8080. The server starts without a compiled client, so the health endpoint and original logo remain available while Vite handles the page.

## Modules and build

`src/server/app.ts` creates a Fastify instance without opening a socket, allowing request-level tests with Fastify injection. `config.ts` validates the process port, and `index.ts` supplies production asset paths and starts the process. `src/client` is plain TypeScript plus CSS. `src/shared` is reserved for pure data transformations shared by server and browser. Vitest runs the tests in `test`; ESLint and TypeScript check the complete source tree.

The container has a build stage and a runtime stage based on `node:24-slim`. Its runtime contains production dependencies, compiled output and original brand assets, and runs as the unprivileged `node` user. Local configuration, notes, tests and infrastructure files are excluded from the container context.

## State and privacy

The scaffold has no persistence, user input, analytics, upstream requests or location storage. Request logging is disabled so future location search URLs do not enter logs. Later location features may retain only coordinates and station identifiers, never addresses or search text. Secrets and environment-specific values belong in private configuration; `.env.example` documents safe settings for local development.

See [ADR 0001](decisions/0001-hosting.md) for hosting and [ADR 0002](decisions/0002-stack.md) for the stack. NOAA CO-OPS is the fixed future tide-data source; predictions are not for navigation.
