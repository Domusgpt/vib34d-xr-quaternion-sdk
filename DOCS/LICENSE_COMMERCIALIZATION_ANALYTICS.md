# License Commercialization Analytics Bridge

The commercialization analytics bridge turns license attestation registrations into dashboard-ready summaries. It is implemented by `src/product/licensing/LicenseCommercializationReporter.js` and consumed by the telemetry harness/Adaptive SDK so partners can see entitlement coverage without reimplementing audit logic.

## What It Tracks

- **Pack registrations.** Every call to `registerLicenseAttestationProfilePack()` records the pack id, metadata, default profile, and which profiles were registered.
- **Profile registrations.** Direct calls to `registerLicenseAttestationProfile()` (from packs or partner code) are captured with source metadata so dashboards can distinguish catalog packs from bespoke profiles.
- **Default changes and adoption.** Applying or changing a default profile, plus invoking `setLicenseAttestorFromProfile()`, updates adoption counters and timestamps. The reporter aggregates adoption counts per profile, segment, region, and pack.
- **SLA benchmarks.** Response targets, availability, and breach windows are summarised (min/max/average) to highlight SLA outliers.

## Accessing Summaries

```js
const sdk = createAdaptiveSDK({
  telemetry: {
    commercialization: {
      onUpdate(summary) {
        console.log('Updated commercialization metrics', summary);
      }
    }
  },
  licenseAttestationProfilePacks: ['enterprise-saas']
});

const summary = sdk.getLicenseCommercializationSummary();
console.table(summary.packs.map(pack => ({
  id: pack.id,
  adoption: pack.adoptionCount,
  defaultProfile: pack.defaultProfileId
})));
```

The summary object mirrors the Vitest expectations documented in `tests/vitest/license-commercialization-reporter.test.js`. It includes:

- `packs`: pack-level adoption data, metadata, and default profile identifiers.
- `profiles`: per-profile adoption counts, SLA snapshots, and pack references.
- `segments` / `regions`: aggregated coverage counts with adoption totals.
- `sla`: aggregate metrics for response time, availability, and breach windows.
- `defaultProfileId`: the current default applied by the telemetry harness.
- `lastUpdated`: ISO timestamp for the most recent change.

## UI Integration

`wearable-designer.html` consumes `getLicenseCommercializationSummary()` to render a commercialization coverage panel. The panel updates automatically via the `telemetry.commercialization.onUpdate` callback passed to `createAdaptiveSDK`, showcasing how partners can bind the summary to analytics dashboards or BI tooling.【F:wearable-designer.html†L318-L453】

## KPI Snapshots & Exports

The commercialization bridge now ships with `LicenseCommercializationSnapshotStore`, which captures periodic KPI snapshots and exposes BI-friendly exports. The telemetry harness wires the store automatically (unless disabled) and provides helper methods for manual capture, scheduling, and exporting:

```js
const sdk = createAdaptiveSDK({
  telemetry: {
    commercialization: {
      snapshotIntervalMs: 60_000,
      snapshotStore: {
        maxSnapshots: 48
      }
    }
  }
});

// Manual capture + KPI reporting
sdk.captureLicenseCommercializationSnapshot({ trigger: 'quarterly-review' });
const kpiReport = sdk.getLicenseCommercializationKpiReport();

// Export for BI tooling
const exportJson = sdk.exportLicenseCommercializationSnapshots({ format: 'json', includeSummary: false });
const csv = sdk.exportLicenseCommercializationSnapshots({ format: 'csv' });
```

Within the wearable designer demo, the "Commercialization Coverage" panel now includes snapshot controls, KPI deltas, export triggers, and a remote persistence log so stakeholders can experience the workflow without writing additional code.【F:wearable-designer.html†L318-L476】

## Remote Persistence & Async Hydration

`LicenseCommercializationSnapshotStore` now supports asynchronous storage adapters and exposes a `whenReady()` helper so partner dashboards can await remote hydration before rendering KPIs. Use the new storage builders in `src/product/licensing/storage/CommercializationSnapshotStorageAdapters.js` to stream snapshots directly into enterprise vaults:

```js
import {
  createSignedS3CommercializationSnapshotStorage,
  createCommercializationSnapshotPayload
} from 'vib34d-ultimate-viewer/src/product/licensing/storage/CommercializationSnapshotStorageAdapters.js';

const remoteStorage = createSignedS3CommercializationSnapshotStorage({
  signingEndpoint: '/api/sign-kpi-upload',
  fetchImplementation: window.fetch.bind(window),
  redactContextKeys: ['licenseKey'],
  serialize: (snapshots, context) => createCommercializationSnapshotPayload(snapshots, {
    ...context,
    channel: 'wearable-sdk'
  })
});

const sdk = createAdaptiveSDK({
  telemetry: {
    commercialization: {
      snapshotStoreOptions: {
        storage: remoteStorage,
        onChange: snapshots => renderDashboard(snapshots)
      },
      snapshotIntervalMs: 86_400_000 // nightly captures
    }
  }
});

await sdk.getLicenseCommercializationSnapshotStore().whenReady();
renderDashboard(sdk.getLicenseCommercializationSnapshots());
```

The wearable designer demo showcases this flow by wiring an asynchronous remote storage adapter, rendering upload history, and waiting on `whenReady()` to refresh the KPI history once remote hydration completes.【F:wearable-designer.html†L318-L485】

## Follow-Ups

- Expand the pack catalog (healthcare, education) with commercialization metadata so KPI snapshots can highlight regulated market coverage.
- Harden production-grade storage adapters with retry/backoff policies and connect nightly KPI jobs to downstream partner BI pipelines.
- Extend partner docs with KPI interpretation guidance and sample dashboard widgets fed by the CSV/JSON exports.

## Operational Runbooks

### Nightly KPI Capture & Export
1. Configure the SDK with `snapshotIntervalMs` (e.g., `86_400_000` for daily captures) and a remote snapshot storage adapter (`createSignedS3CommercializationSnapshotStorage`).
2. Register a telemetry middleware that injects signing metadata required by the downstream vault (key identifiers, environment labels).
3. Schedule a cron/CI job that calls `sdk.captureLicenseCommercializationSnapshot({ trigger: 'scheduled' })` immediately before midnight UTC.
4. After capture, invoke `sdk.exportLicenseCommercializationSnapshots({ format: 'json' })` and upload the payload to the BI landing zone; store export metadata (snapshot count, retention policy) alongside the artifact for auditors.

### Quarterly Commercialization Review
1. Call `sdk.getLicenseCommercializationKpiReport({ limit: 4 })` to compare the latest quarter against the previous three snapshots.
2. Generate CSV exports for executive review with `sdk.exportLicenseCommercializationSnapshots({ format: 'csv', includeSummary: true })` and circulate the output to finance/legal stakeholders.
3. Use `sdk.getLicenseCommercializationSummary()` to refresh the dashboard widgets that highlight default profile adoption, SLA deltas, and regional coverage prior to the review meeting.

### Incident Response (Attestation Failure)
1. Monitor the telemetry harness for `compliance.license.attestor_error` audit entries via `sdk.getTelemetryAuditTrail()`.
2. When detected, pull the most recent commercialization snapshot (`sdk.getLatestLicenseCommercializationSnapshot()`) to determine which profiles or packs are impacted.
3. Trigger a manual snapshot (`sdk.captureLicenseCommercializationSnapshot({ trigger: 'incident-response' })`) so remediation workstreams have a frozen KPI baseline.
4. File the incident report with attached audit logs and KPI exports, then reset the telemetry metrics with `sdk.resetTelemetryMetrics()` after resolution to monitor the next window cleanly.
