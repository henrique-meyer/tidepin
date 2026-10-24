# Implementation plan

Every public change starts from a tracked task and records its scope here.

| Task | Scope | Status |
| --- | --- | --- |
| TIDEDEMO-4 | Scaffold the Node 24 / TypeScript Fastify server, Vite client, tooling, non-root container, original Tidepin logo, and hosting/stack decisions. | Complete |
| TIDEDEMO-5 | Add parameterized Container Apps Bicep, safe example parameters and infrastructure documentation, plus pull-request checks for the app, templates and non-root container health. | Implemented; verification |

The first scaffold intentionally contains only a logo placeholder and a health endpoint. Infrastructure templates and PR checks are implemented separately from resource provisioning and deployment. Application screens and tide-data features follow in their own tasks.
