# ADR 0002: Node and TypeScript stack

Status: Accepted

## Context

The demo should reuse the BoltClock development and container conventions without its domain-specific services. It needs a small server, a browser client, and testable shared logic.

## Decision

Use Node 24, strict TypeScript with ES modules, Fastify 5, a plain TypeScript client built with Vite, Vitest, and ESLint. Keep server code in `src/server`, browser code in `src/client`, shared pure modules in `src/shared`, tests in `test`, and original brand assets in `assets`.

`npm run dev` starts the Fastify server and Vite client together. Vite proxies server and brand-asset routes in development. Production compiles the server and client into `dist`; Fastify serves the compiled client and original assets. A two-stage `node:24-slim` Dockerfile installs only production dependencies in the runtime stage and runs as the built-in non-root `node` user.

## Consequences

Browser code has no UI framework. Shared data transformations can be tested without a browser or server. Runtime configuration uses environment variables, documented with safe example values in `.env.example`. Fastify owns NOAA metadata/prediction access and bounded process caches; the plain TypeScript client owns Start, location selection, settings, session timing and the SVG/HTML tide display. There is no server database or persistent volume. Device storage is limited to coordinates/station identity and the separate display preferences, as described in the [system design](../system-design.md).
