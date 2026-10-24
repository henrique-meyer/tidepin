# Infrastructure

The demo follows the existing BoltClock container-hosting pattern. `main.bicep` targets one existing resource group and describes:

| Resource | Purpose and limits |
| --- | --- |
| Log Analytics workspace | Container logs, 30-day retention, 0.1 GB daily ingestion cap |
| Container Apps environment | Consumption workload profile |
| Container app, optional during bootstrap | One stateless public image; 0.25 vCPU, 0.5 GiB, zero idle replicas, at most one replica |
| Deploy identity and federated credential, optional | GitHub OIDC; Reader on the resource group and Contributor on this container app only |
| Monthly budget, optional | Actual and forecast notifications; it does not enforce a spending limit |
| Shared dashboard, optional during bootstrap | Links to every deployed project resource, its OIDC credential and role assignments |

There is no database, storage account, Function App, or background ingest service. The template does not configure GitHub by itself. The deployment workflow publishes images and updates an already provisioned app. DNS setup and certificate issuance follow separately.

## Check without cloud credentials

Install the Azure CLI and Bicep CLI, then compile the template and safe example:

```powershell
az bicep build --file infra/main.bicep --stdout > $null
Copy-Item infra/main.bicepparam.example infra/ci.bicepparam
az bicep build-params --file infra/ci.bicepparam --stdout > $null
```

`infra/ci.bicepparam` is gitignored. The example contains deliberately invalid deployment names such as `<app>`; compiling it checks the parameter contract without creating resources. A successful compilation is not a successful deployment or a permission check.

Pull-request CI repeats these checks on a hosted runner. It also runs lint, type checking, unit tests and the production build, then builds the Docker image, starts it on port 8080, requires the exact health JSON and verifies the running process uses a non-root UID. The workflow needs no deployment secrets or Azure sign-in.

## Private configuration

Copy the example to `local/infra/main.bicepparam` in the separate private notes repository. Update its `using` statement to point to this public checkout's `infra/main.bicep`, relative to the private parameter file. Real names, domains, subscription and identity IDs, budget recipients and keys belong only in private configuration. Never place the real parameter file in this public repository.

Every resource name is parameterized. Ingress requires HTTPS and points to `targetPort`; startup, readiness and liveness probes use `healthPath`. Leave `googleMapsApiKey` empty until the location picker is configured; otherwise supply a restricted browser key through private parameters. The key becomes a Container Apps secret. The template also supplies `PUBLIC_BASE_URL`, defaulting to the generated app address; the current server does not consume it. `sessionLimitMinutes` / `SESSION_LIMIT_MINUTES` accepts 1–120 minutes and defaults to 120; the browser session timer returns an expired display to Start and stops ordinary display polling, allowing the platform's idle scale-to-zero policy to act. This cooperative client limit is not a server quota; see [ADR 0003](../docs/decisions/0003-demo-session.md).

The template fixes the smallest resource allocation and scaling bounds to protect the demo's intended idle cost. Scale-to-zero can cause cold starts; it does not guarantee a zero bill, and the log ingestion cap is separate from the optional budget.

## Provisioning sequence

For a new installation, use an already authorized subscription and resource group:

1. Verify the Azure account and permitted resource group. Start with `deployApp = false` to create the workspace, environment and optional deploy identity before an image exists.
2. Preview changes with `az deployment group what-if`, then deploy only the reviewed resources. Keep outputs in private notes.
3. Publish a public GHCR image. Enable `deployApp` and set `containerImage` to a published immutable commit tag or digest, then preview and deploy again. No registry password is required for a public package.
4. Configure the GitHub `production` environment's `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` and `AZURE_CONTAINERAPP_NAME` secrets. Use the deployment identity's client ID, never a long-lived Azure credential.
5. Verify the active revision and request `https://<app-address>/health`. A successful image pull alone does not prove the app is healthy.
6. Set `dashboardName` to create the shared dashboard listing the project's resources and record the exact DNS instructions privately. DNS changes and hostname binding follow separately.

The deploy identity can read this resource group and modify this container app. It cannot provision the environment, workspace, identities or role assignments, and cannot update other apps. The operator applying Bicep needs the corresponding provisioning and role-assignment permissions.

Set `githubFederationSubject` to the **exact** subject GitHub emits for the `production` environment. Depending on repository settings it can be `repo:<owner>/<repository>:environment:production` or include immutable IDs, such as `repo:<owner>@<owner-id>/<repository>@<repository-id>:environment:production`. Verify the repository's current OIDC configuration; never assume the name-only form. An empty subject skips the identity and its role assignments.

After DNS verification and a free managed certificate have been issued, retain `customDomainName` and `customDomainCertificateId` in private parameters. Both must be set to preserve the HTTPS binding on subsequent Bicep deployments; leaving either empty omits it. The template does not create a certificate or DNS records.

### Custom hostname and managed certificate

DNS changes are performed by the owner of the zone. For a subdomain, verify a **direct** CNAME to the app's generated address and the TXT record at `asuid.<subdomain>` using the actual app's `properties.customDomainVerificationId`. An existing parent-zone `asuid` record may belong to another service and must be preserved. Check existing CAA policy read-only; when the zone has CAA restrictions it must permit `digicert.com` for the free managed certificate. Do not change DNS or replace a verification record as part of certificate binding.

After the owner authorizes the operation, validate the hostname through the provider before requesting a certificate:

```sh
az containerapp hostname add --subscription <subscription-id> --resource-group <resource-group> --name <app> --hostname <hostname> --output none
az containerapp hostname bind --subscription <subscription-id> --resource-group <resource-group> --name <app> --environment <environment> --hostname <hostname> --validation-method CNAME --output none
```

The second command finds or creates a free managed certificate when no uploaded certificate is supplied. A rejected DNS validation is an actionable blocker: preserve the provider response privately and wait for corrected DNS instead of repeatedly sending the same request. During issuance, bounded requests to the default health endpoint can keep the app reachable without permanently changing its zero-to-one replica policy.

Read back the successful certificate and secured hostname, then record the hostname, certificate resource ID and HTTPS base URL only in the private parameters. Refresh `containerImage` from the running app before the Bicep apply so domain setup cannot roll back a newer deployment. Preview the approved resource scope, redeploy those parameters, read back the retained binding, and verify `https://<hostname>/health` returns the exact process-health response while `http://<hostname>/health` redirects to HTTPS. The shared dashboard also links the referenced managed certificate; its issuance remains outside the template. Keep actual records, identifiers, endpoints and issuance evidence in the private runbook. See the [current managed-certificate requirements](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates).

## Deployment workflow

`.github/workflows/deploy.yml` runs on pushes to `main` and can be dispatched manually for `main`. A serial concurrency group prevents overlapping rollouts. It publishes the public repository's image to GHCR with an immutable `sha-<commit>` tag and the convenience `prod` tag. The first image run works without Azure secrets; missing production configuration explicitly skips the rollout.

After the first package publication, set its visibility to public in GitHub's package settings and verify anonymous access before provisioning the app. Set all five production environment secrets only after the app and its scoped OIDC role assignment exist. A subsequent main-branch run signs in with OIDC, updates only that app to the immutable commit tag, wakes a scaled-to-zero app with health requests, requires a healthy revision, and checks the exact `{"status":"ok"}` response. The public workflow masks generated hostnames and revision names before using them in diagnostics, and suppresses Azure resource output. Logs contain state and attempt counts, not environment values.

Deployment updates do not reapply Bicep or change scaling, secrets, DNS or certificates. Infrastructure changes require an operator to preview and apply private parameters separately. The shared dashboard has a resource link for every resource the template creates; it is an Azure resource in the project's group and follows that group's access permissions.

See [ADR 0001](../docs/decisions/0001-hosting.md) and the [system design](../docs/system-design.md).
