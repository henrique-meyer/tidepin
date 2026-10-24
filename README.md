# Tidepin

A web demo for viewing NOAA CO-OPS tide predictions. The initial scaffold contains a Tidepin logo placeholder and a process-health endpoint; the tide graph and application screens follow in separate tasks.

**Predictions only. Not for navigation.** Tide prediction data is provided by [NOAA CO-OPS](https://tidesandcurrents.noaa.gov). The demo is not a source of navigational guidance.

## Run locally

Use Node 24 or newer:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The Fastify server listens on port 8080 and serves `GET /health` as `{"status":"ok"}`. `PORT` may be changed in `.env`; when changing it for development, update the matching Vite proxy target too.

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

`src/server` holds Fastify, `src/client` holds the Vite page, `src/shared` is reserved for pure shared modules, `test` holds Vitest tests, and `assets` holds original brand files. The layout follows the [BoltClock demo](https://github.com/henrique-meyer/boltclock).

See the [system design](docs/system-design.md), [implementation plan](docs/plan.md), [infrastructure guide](infra/README.md), and the decisions for [hosting](docs/decisions/0001-hosting.md) and [the stack](docs/decisions/0002-stack.md). Pull-request CI verifies the app, Bicep templates and a running non-root container. Infrastructure is parameterized; provisioning and deployment automation follow separately. Real environment values, private notes, and secrets must stay outside this public repository.

## License

[MIT](LICENSE). Original Tidepin logo artwork is included without alteration.
