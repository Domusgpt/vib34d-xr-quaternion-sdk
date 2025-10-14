# License Attestation Profile Catalog

This catalog curates commercialization-ready attestation packs that partners can import without reinventing telemetry or licensing primitives. Each pack bundles remote attestation endpoints, SLA defaults, and metadata for a target customer segment. Packs are delivered through the `LicenseAttestationProfileCatalog` module and can be registered via the Adaptive SDK or directly on the `ProductTelemetryHarness`.

## Available Packs

### Enterprise SaaS Compliance Pack (`enterprise-saas`)
- **Audience:** Highly regulated enterprise programs that require multi-region redundancy and strict fail-closed behaviour.
- **Regions:** `global`, `na`, `eu` by default. Override with `regions` when registering the pack.
- **SLA Defaults:** 900 ms response target, 99.9% availability, 5-minute breach detection window, fail-open disabled.
- **Headers:** Adds `x-sdk-product` and `x-sdk-tier=enterprise` to every request.
- **Metadata:** Marks profiles with `segment=enterprise` and `complianceTier=regulated` for downstream analytics.

### Studio Collaboration Pack (`studio-collab`)
- **Audience:** Design studios collaborating on shared wearable experiences that balance reliability with creative agility.
- **Regions:** `global`, `latam` by default with optional `collaborationId` scoping.
- **SLA Defaults:** 1.5 s response target, 99.5% availability, 15-minute breach window, fail-open enabled to favour iteration.
- **Headers:** Includes `x-sdk-tier=studio` and injects the `x-collaboration-id` supplied during registration.
- **Metadata:** Adds `segment=studio`, `collaborationId`, and `complianceTier=managed` for reporting.

### Indie Lab Starter Pack (`indie-lab`)
- **Audience:** Independent labs and prototyping collectives that need light-touch attestation with permissive fail-open defaults.
- **Regions:** `global` default with optional overrides and `projectCode` scoping.
- **SLA Defaults:** 2.5 s response target, 99.0% availability, 30-minute breach window, fail-open enabled.
- **Headers:** Adds `x-sdk-tier=indie` alongside the provided `x-project-code`.
- **Metadata:** Annotates profiles with `segment=indie`, `projectCode`, and `complianceTier=experimental`.

## Registration Options

Each pack accepts a shared options object when registered:

| Option | Description |
|--------|-------------|
| `regions` | Array of region slugs to generate profiles for (defaults come from the pack). |
| `baseUrl` | Root service URL used to compose attestation, revocation, and entitlement endpoints. |
| `pollIntervalMs` / `minimumPollIntervalMs` | Override cadence for scheduled attestation. |
| `failOpen` | Force fail-open or fail-closed regardless of the pack default. |
| `headers` | Additional HTTP headers merged into the remote attestor configuration. |
| `collaborationId` / `projectCode` | Segment identifiers for studio and indie packs. |
| `defaultProfileId` | Overrides the default profile used when no explicit profile is supplied. |
| `applyDefault` | Set to `false` to register a pack without changing the current default profile. |
| `sla` | Partial overrides for response target, availability, breach window, and notes. |
| `metadata` | Additional metadata merged into the pack summary for analytics. |

## Usage Examples

### Registering During SDK Bootstrap
```js
const sdk = createAdaptiveSDK({
  licenseAttestationProfilePackId: 'enterprise-saas',
  licenseAttestationProfilePackOptions: {
    regions: ['global', 'apac'],
    baseUrl: 'https://licensing.partner.example.com',
    pollIntervalMs: 10 * 60 * 1000
  }
});
```

### Registering Multiple Packs at Runtime
```js
const packSummary = sdk.registerLicenseAttestationProfilePack('studio-collab', {
  collaborationId: 'aurora',
  regions: ['global', 'latam'],
  applyDefault: false
});

console.log(packSummary.profileIds);
// => ['studio-collab/aurora/global', 'studio-collab/aurora/latam']
```

### Registering a Custom Pack Descriptor
```js
sdk.registerLicenseAttestationProfilePack({
  id: 'partner-managed',
  defaults: { baseUrl: 'https://licenses.partner.example.com' },
  buildProfiles: ({ baseUrl }) => ([
    {
      id: 'partner-managed/global',
      attestor: { attestationUrl: `${baseUrl}/global/attest` },
      metadata: { segment: 'partner', complianceTier: 'shared' }
    }
  ])
});
```

## Audit & Compliance Notes
- Pack registration emits `system.license.attestation_profile_pack_registered` events in the telemetry audit log.
- Individual profile registrations and default changes continue to produce their existing audit entries.
- Pack metadata is preserved so compliance exports can reason about segment/region coverage without additional lookups.

## Next Steps
- Publish SLA benchmarks per region based on telemetry collected from early adopter partners.
- ✅ Pack metadata now flows into the commercialization dashboard via `LicenseCommercializationReporter`, enabling entitlement coverage and SLA adoption views directly in the telemetry harness/SDK summary APIs.
- Expand the catalog with marketplace-specific packs (e.g., healthcare, defense) once legal review completes.
