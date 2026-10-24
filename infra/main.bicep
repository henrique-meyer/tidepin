targetScope = 'resourceGroup'

// Environment-specific values belong in private parameters, outside this repository.
@description('Region for the demo resources.')
param location string = 'eastus'

@description('Log Analytics workspace name.')
param logAnalyticsName string

@description('Container Apps environment name.')
param environmentName string

@description('Container app name.')
param containerAppName string

@description('Container name within the app.')
param containerName string = 'app'

@description('Create the app only after its public image has been published.')
param deployApp bool = false

@description('Public container image, for example ghcr.io/<owner>/<repository>:prod.')
param containerImage string = ''

@minValue(1)
@maxValue(65535)
@description('Unprivileged HTTP port used by the process and ingress.')
param targetPort int = 8080

@description('Process-health endpoint used by startup, readiness and liveness probes.')
param healthPath string = '/health'

@description('Browser Maps key, restricted by API and HTTP referrer. Empty until the location picker is configured.')
@secure()
param googleMapsApiKey string = ''

@description('Public base URL. Empty uses the generated Container Apps address.')
param publicBaseUrl string = ''

@minValue(0)
@description('Display session duration in minutes; enforcement is implemented by the session feature.')
param sessionLimitMinutes int = 120

@description('Previously verified hostname to retain on subsequent deployments. Empty skips binding.')
param customDomainName string = ''

@description('Previously issued managed certificate resource ID. Empty skips binding.')
param customDomainCertificateId string = ''

@description('Deploy identity name. Empty uses the app name with a deploy suffix.')
param deployIdentityName string = ''

@description('Exact GitHub OIDC subject for the production environment, including immutable IDs when enabled. Empty skips the identity.')
param githubFederationSubject string = ''

@description('Federated credential name within the deploy identity.')
param federationCredentialName string = 'github-production'

@description('Shared dashboard name. Empty skips the dashboard during bootstrap.')
param dashboardName string = ''

@minValue(0)
@description('Optional monthly resource-group budget in the billing currency. Zero skips it.')
param budgetAmount int = 0

@description('Budget resource name.')
param budgetName string = 'monthly-cost'

@description('Private budget alert recipients. Empty skips the budget.')
param budgetContactEmails array = []

@description('Fixed budget start date, the first day of a month in yyyy-MM-01 format.')
param budgetStartDate string = ''

@description('Tags applied to each taggable resource.')
param tags object = {
  project: 'tidepin'
}

var createDeployIdentity = !empty(githubFederationSubject)
var deployIdentityResolvedName = empty(deployIdentityName) ? '${containerAppName}-deploy' : deployIdentityName
var bindCustomDomain = !empty(customDomainName) && !empty(customDomainCertificateId)
var createBudget = budgetAmount > 0 && !empty(budgetContactEmails)
var dashboardResolvedName = empty(dashboardName) ? 'project-resources' : dashboardName
var defaultBaseUrl = 'https://${containerAppName}.${containerEnv.properties.defaultDomain}'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.1')
    }
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: containerAppName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: union({
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }, bindCustomDomain ? {
        customDomains: [
          {
            name: customDomainName
            bindingType: 'SniEnabled'
            certificateId: customDomainCertificateId
          }
        ]
      } : {})
      secrets: empty(googleMapsApiKey) ? [] : [
        {
          name: 'google-maps-api-key'
          value: googleMapsApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: containerName
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'SESSION_LIMIT_MINUTES'
              value: string(sessionLimitMinutes)
            }
            {
              name: 'PUBLIC_BASE_URL'
              value: empty(publicBaseUrl) ? defaultBaseUrl : publicBaseUrl
            }
            union({ name: 'GOOGLE_MAPS_API_KEY' }, empty(googleMapsApiKey) ? { value: '' } : { secretRef: 'google-maps-api-key' })
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              initialDelaySeconds: 2
              periodSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (createDeployIdentity) {
  name: deployIdentityResolvedName
  location: location
  tags: tags
}

resource deployFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (createDeployIdentity) {
  parent: deployIdentity
  name: federationCredentialName
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: githubFederationSubject
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

// These are public built-in role definitions, not environment identifiers.
var readerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')

resource deployReadsGroup 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createDeployIdentity) {
  name: guid(resourceGroup().id, deployIdentityResolvedName, readerRole)
  properties: {
    roleDefinitionId: readerRole
    principalId: deployIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployUpdatesApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createDeployIdentity && deployApp) {
  name: guid(resourceGroup().id, containerAppName, deployIdentityResolvedName, contributorRole)
  scope: containerApp
  properties: {
    roleDefinitionId: contributorRole
    principalId: deployIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (createBudget) {
  name: budgetName
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: budgetContactEmails
        thresholdType: 'Actual'
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: budgetContactEmails
        thresholdType: 'Forecasted'
      }
    }
  }
}

// Links cover every resource described by this deployment, including its dashboard.
var dashboardResourceIds = concat(
  [law.id, containerEnv.id],
  deployApp ? [containerApp!.id] : [],
  createDeployIdentity ? [deployIdentity!.id, deployFederation!.id, deployReadsGroup!.id] : [],
  createDeployIdentity && deployApp ? [deployUpdatesApp!.id] : [],
  createBudget ? [budget!.id] : [],
  [resourceId('Microsoft.Portal/dashboards', dashboardResolvedName)]
)
var dashboardResourceLinks = [for id in dashboardResourceIds: '- [${last(split(id, '/'))}](https://portal.azure.com/#resource${id})']

resource dashboard 'Microsoft.Portal/dashboards@2022-12-01-preview' = if (!empty(dashboardName)) {
  name: dashboardResolvedName
  location: location
  tags: union(tags, { 'hidden-title': 'Tidepin Demo' })
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          {
            position: {
              x: 0
              y: 0
              colSpan: 8
              rowSpan: 6
            }
            metadata: {
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              inputs: []
              settings: {
                content: {
                  settings: {
                    title: 'Project resources'
                    subtitle: 'Consumption demo infrastructure'
                    markdownSource: 1
                    content: join(dashboardResourceLinks, '\n')
                  }
                }
              }
            }
          }
        ]
      }
    ]
    metadata: {
      model: {
        timeRange: {
          value: {
            relative: {
              duration: 24
              timeUnit: 1
            }
          }
          type: 'MsPortalFx.Composition.Configuration.ValueTypes.TimeRange'
        }
      }
    }
  }
}

output containerAppFqdn string = deployApp ? containerApp!.properties.configuration.ingress.fqdn : ''
output customDomainVerificationId string = containerEnv.properties.customDomainConfiguration.customDomainVerificationId
output deployIdentityClientId string = createDeployIdentity ? deployIdentity!.properties.clientId : ''
