# ADR 0001: Azure Container Apps hosting

Status: Accepted

## Context

The demo needs one stateless HTTP process, a low idle cost, and a repeatable container deployment. The existing BoltClock demo supplies the established hosting pattern.

## Decision

Use Azure Container Apps on its Consumption profile in East US. Start with 0.25 vCPU and 0.5 GiB, scale to zero when idle, and allow at most one replica. Publish the image as a public GHCR package. The process listens on `PORT` (8080 by default); `GET /health` reports process readiness independently of upstream data.

Infrastructure is described in parameterized Bicep. All environment-specific names and values stay in private configuration. GitHub Actions deploys with OIDC through a user-assigned identity scoped to updating the container app. The application uses a free managed certificate for its configured hostname. A shared Azure dashboard lists the resources it uses.

## Consequences

An idle demo may need a cold start. Data caches are disposable and cannot rely on local disk surviving a revision. Provisioning and certificate issuance are operator steps separate from ordinary image rollouts; private parameters must preserve the current image and verified binding when reapplied. [ADR 0003](0003-demo-session.md) defines the bounded client session that stops ordinary display polling. Scale-to-zero reduces idle work but does not guarantee zero cost. The [infrastructure guide](../../infra/README.md) records the repeatable procedure using placeholders.
