# Implementation plan

Every public change starts from a tracked task and records its scope here.

| Task | Scope | Status |
| --- | --- | --- |
| TIDEDEMO-4 | Scaffold the Node 24 / TypeScript Fastify server, Vite client, tooling, non-root container, original Tidepin logo, and hosting/stack decisions. | Complete |
| TIDEDEMO-5 | Add parameterized Container Apps Bicep, safe example parameters and infrastructure documentation, plus pull-request checks for the app, templates and non-root container health. | Complete |
| TIDEDEMO-6 | Add public container publishing and OIDC deployment automation, provision the approved Consumption resources and shared dashboard, and verify the default app endpoint before the separate DNS handoff. | Complete |
| TIDEDEMO-7 | Verify owner-managed DNS, bind a free managed certificate to the existing app, preserve the binding in private parameters and verify HTTPS health plus HTTP redirection after a redeploy. | Complete |
| TIDEDEMO-8 | Apply source Tidepin color, typography, spacing and motion tokens, with system light/dark appearance and accessible contrast preferences. | Complete |
| TIDEDEMO-9 | Copy the Start display flow, browser-location or map choice, saved-station startup and session-ended return state with original branding. | Complete |
| TIDEDEMO-10 | Add the source-style top bar, user-requested full screen and Settings dialog with feet/meters height, 12/24-hour clock and preference-only Reset; publish one shared preference contract for every displayed height. | Complete |
| TIDEDEMO-11 | Add a separate location picker with Maps pin/place search/current location, nearest NOAA prediction-station lookup, validated station zones, coordinate/station-only storage and alphanumeric station-ID integration with the prediction client. | Complete |
| TIDEDEMO-12 | Add NOAA source credit, navigation disclaimer and personal/source footer; keep README wording aligned and external links safe. | Complete |
| TIDEDEMO-13 | Add the configurable bounded demo session, source-style footer time left, synchronous expiry/refresh-stop lifecycle and scale-to-zero ADR. | Complete |
| TIDEDEMO-14 | NOAA CO-OPS curve/events client with bounded cache, pacing and typed failures; pure chart, interpolation, station-local DST calculations and frozen fixture tests. | Complete |
| TIDEDEMO-15 | Render the station-local daily NOAA tide graph, current prediction and next high/low with shared units, visible-session refresh, loading/saved/error states and one server-wide upstream scheduler. | Complete |
| TIDEDEMO-16 | Reconcile public usage, architecture, data, deployment and decision docs with shipped behavior; add sanitized screenshots and complete the public task history. | Complete |
| TIDEDEMO-17 | Have the DNS-zone owner configure the verification and routing records needed for the separately bound demo hostname. | Complete |
| TIDEDEMO-18 | Apply the owner-selected source-available noncommercial project license, metadata, branding terms, browser bundle notice and runtime license copy. | Complete |
| TIDEDEMO-19 | Add a subtle static ocean background driven by the graph's current height and window range, with theme-aware colors, smooth finite level updates, reduced-motion support and no extra requests or wave animation. | Complete |
| TIDEDEMO-20 | Add optional tiny, slow surface-wave motion within the existing ocean component, retaining its tide mapping/palette and stopping motion for reduced-motion, hidden and neutral states. | Complete |
| TIDEDEMO-21 | Combine the NOAA credit and navigation disclaimer in one naturally wrapping footer paragraph, remove the redundant prediction sentence and preserve personal/source credit on both display and location pages. | Complete |
| TIDEDEMO-22 | Estimate subordinate-station curves and current heights with a tested half-cosine between bracketing predicted extremes, label estimates clearly, reuse the same level for the ocean, preserve harmonic samples and verify real station handling. | Implemented; independent verification |

The Start/display shell integrates shared controls, location selection and the station-local tide graph. Infrastructure templates and PR checks are separate from resource provisioning and deployment. The tide-data API and graph reuse the tested prediction-data modules and one shared upstream scheduler. NOAA predictions only; not for navigation.

The tracking groups are Step 1 infrastructure (TIDEDEMO-1), Step 2 UI/UX (TIDEDEMO-2) and Step 3 tide graph (TIDEDEMO-3). The table preserves task-level work rather than treating an epic as an implementation change. Planned or review-pending features are not claims about the shipped application.

## Follow-up work

| Task | Scope | Status |
| --- | --- | --- |
| TIDEDEMO-24 | Correct idle/loading Refresh cursor behavior and prevent refresh-state layout shifts, with cursor and scroll-height checks across screen sizes, themes and supported browser engines. | Implemented; independent verification |
