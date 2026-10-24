# Implementation plan

Every public change starts from a tracked task and records its scope here.

| Task | Scope | Status |
| --- | --- | --- |
| TIDEDEMO-4 | Scaffold the Node 24 / TypeScript Fastify server, Vite client, tooling, non-root container, original Tidepin logo, and hosting/stack decisions. | Complete |
| TIDEDEMO-5 | Add parameterized Container Apps Bicep, safe example parameters and infrastructure documentation, plus pull-request checks for the app, templates and non-root container health. | Complete |
| TIDEDEMO-6 | Add public container publishing and OIDC deployment automation, provision the approved Consumption resources and shared dashboard, and verify the default app endpoint before the separate DNS handoff. | Complete |
| TIDEDEMO-7 | Verify owner-managed DNS, bind a free managed certificate to the existing app, preserve the binding in private parameters and verify HTTPS health plus HTTP redirection after a redeploy. | In progress |
| TIDEDEMO-8 | Apply source Tidepin color, typography, spacing and motion tokens, with system light/dark appearance and accessible contrast preferences. | Complete |
| TIDEDEMO-12 | Add the three-line NOAA source credit, navigation disclaimer and personal/source footer; keep README wording aligned and external links safe. | Complete |
| TIDEDEMO-14 | NOAA CO-OPS curve/events client with bounded cache, pacing and typed failures; pure chart, interpolation, station-local DST calculations and frozen fixture tests. | Complete |

The scaffold contains a logo placeholder and health endpoint. Infrastructure templates and PR checks are separate from resource provisioning and deployment. The data modules are implemented separately from the upcoming tide-data HTTP and UI integration. NOAA predictions only; not for navigation.
