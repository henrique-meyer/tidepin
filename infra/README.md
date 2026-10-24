# Infrastructure

The demo follows the existing BoltClock container-hosting pattern. `main.bicep` targets one existing resource group and describes:

| Resource | Purpose and limits |
| --- | --- |
| Log Analytics workspace | Container logs, 30-day retention, 0.1 GB daily ingestion cap |
| Container Apps environment | Consumption workload profile |
| Container app, optional during bootstrap | One stateless public image; 0.25 vCPU, 0.5 GiB, zero idle replicas, at most one replica |
| Deploy identity and federated credential, optional | GitHub OIDC; Reader on the resource group and Contributor on this container app only |
| Monthly budget, optional | Actual and forecast notifications; it does not enforce a spending limit |

There is no database, storage account, Function App, or background ingest service. The template does not provision resources or configure GitHub by itself. Deployment automation, the shared resource dashboard, DNS setup and certificate issuance are separate tasks.

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

Every resource name is parameterized. Ingress requires HTTPS and points to `targetPort`; startup, readiness and liveness probes use `healthPath`. Leave `googleMapsApiKey` empty until the location picker is configured; otherwise supply a restricted browser key through private parameters. The key becomes a Container Apps secret. `PUBLIC_BASE_URL` defaults to the generated app address, while `SESSION_LIMIT_MINUTES` defaults to 120. The session feature implements enforcement separately.

The template fixes the smallest resource allocation and scaling bounds to protect the demo's intended idle cost. Scale-to-zero can cause cold starts; it does not guarantee a zero bill, and the log ingestion cap is separate from the optional budget.

## Provisioning sequence

These are operator steps for the later deployment task, using an already authorized subscription and resource group:

1. Verify the Azure account and permitted resource group. Start with `deployApp = false` to create the workspace, environment and optional deploy identity before an image exists.
2. Preview changes with `az deployment group what-if`, then deploy only the reviewed resources. Keep outputs in private notes.
3. Publish a public GHCR image. Enable `deployApp` and set `containerImage` to a published immutable commit tag or digest, then preview and deploy again. No registry password is required for a public package.
4. Configure the GitHub `production` environment's `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` and `AZURE_CONTAINERAPP_NAME` secrets. Use the deployment identity's client ID, never a long-lived Azure credential.
5. Verify the active revision and request `https://<app-address>/health`. A successful image pull alone does not prove the app is healthy.
6. Create the shared dashboard listing the project's resources and record the exact DNS instructions privately. DNS changes and hostname binding follow separately.

The deploy identity can read this resource group and modify this container app. It cannot provision the environment, workspace, identities or role assignments, and cannot update other apps. The operator applying Bicep needs the corresponding provisioning and role-assignment permissions.

Set `githubFederationSubject` to the **exact** subject GitHub emits for the `production` environment. Depending on repository settings it can be `repo:<owner>/<repository>:environment:production` or include immutable IDs, such as `repo:<owner>@<owner-id>/<repository>@<repository-id>:environment:production`. Verify the repository's current OIDC configuration; never assume the name-only form. An empty subject skips the identity and its role assignments.

After DNS verification and a free managed certificate have been issued, retain `customDomainName` and `customDomainCertificateId` in private parameters. Both must be set to preserve the HTTPS binding on subsequent Bicep deployments; leaving either empty omits it. The template does not create a certificate or DNS records.

See [ADR 0001](../docs/decisions/0001-hosting.md) and the [system design](../docs/system-design.md).
