# Telemetry Privacy & Consent Guide

This guide captures the privacy, consent, and data minimization practices that govern telemetry usage across the Adaptive Interface Engine and associated SDK deliverables.

## Objectives
- Provide clear default classifications for emitted telemetry so partners understand when explicit consent is required.
- Describe how to gate analytics/biometric streams and expose audit trails for compliance reviews.
- Outline integration hooks for partner teams to extend consent flows and hardware adapter lifecycle events.

## Telemetry Classifications
The `ProductTelemetryHarness` now tags every event with a classification before dispatch. Default mappings:

| Classification | Description | Consent Default |
|----------------|-------------|-----------------|
| `system` | Operational health, adapter lifecycle, SDK boot events. | Allowed |
| `interaction` | Real-time adaptive focus/gesture streams required for UI responsiveness. | Allowed |
| `analytics` | Monetization, layout strategy, and design activation metrics. | Blocked until consent |
| `biometric` | Physiological streams (stress, heart rate, temperature). | Blocked until consent |
| `compliance` | Schema validation issues, consent updates, audit reporting. | Allowed |

Partners can append custom rules via `registerClassificationRule` or override defaults during SDK bootstrap (`telemetry.defaultConsent`).

## Consent Lifecycle
- `updateTelemetryConsent(map, metadata)` toggles any classification at runtime. The harness logs every change under `privacy.consent.updated` for audit review and exposes a snapshot via `getTelemetryConsent()`.
- Events that lack consent are dropped. The harness writes a `privacy.event.blocked` audit record containing the event name and classification so teams can surface consent dialogs or fallback UI.
- Identity calls default to the `system` classification. Pass `{ classification: 'analytics' }` to `identify` if identity is tied to analytics consent.

### Audit Trail
Call `telemetry.getAuditTrail()` (or `engine.getTelemetryAuditTrail()` via the SDK) to retrieve the rolling window (default 200 entries) of compliance events. The array includes timestamps, payload metadata, and the classification associated with each entry.

### Compliance Vault Provider
Use `ComplianceVaultTelemetryProvider` when compliance teams need a persisted export of consent changes and schema issues. The provider accepts a custom storage adapter (defaulting to `localStorage` or in-memory fallback), captures both telemetry events and audit log entries, and exposes `getRecords()`, `clear()`, `flush()`, and `whenReady()` helpers. The wearable designer demo now registers the vault by default, surfaces consent toggles, and lets reviewers download the captured JSON log. Partners can supply remote persistence by wiring one of the storage adapters below:

- `createSignedS3StorageAdapter` – requests a pre-signed S3 URL from a signing endpoint, uploads the JSON payload, and optionally deletes prior exports.
- `createLogBrokerStorageAdapter` – batches audit entries to a log or compliance broker endpoint via HTTP POST.

These adapters ship under `src/product/telemetry/storage/RemoteStorageAdapters.js` and can be customized with bespoke `fetch` implementations, serialization strategies, and error hooks.

#### Retention & Encryption Controls

- **Retention metadata baked into every export.** Both adapters now accept a `retentionPolicy` option (string identifiers such as `"regulatory"`, millisecond durations, or structured objects) that is normalized and injected into signing requests, upload headers (`x-amz-meta-retention`), and broker headers (`x-retention-policy`). Compliance teams can rely on the vault stream to include the declared retention window for downstream deletion workflows.
- **Encryption hooks for partner KMS/HSM pipelines.** Provide `encryptPayload(payload, context)` to either adapter to transform the serialized audit package before transport. The hook can return a raw encrypted string/ArrayBuffer or an object describing the encrypted body, `contentType`, additional headers (e.g., `x-amz-server-side-encryption`), and metadata (surfaced back to the signing service and vaulted audit log). This enables customer-managed keys, HSM signatures, or attestation tokens without forking the adapters.
- **Metadata surfaced for auditing.** The signing call receives any encryption metadata so downstream services can stamp key IDs or envelope references alongside the retention policy. `onUploadComplete` now reports both `retentionPolicy` and `encryptionMetadata` so compliance dashboards can show the exact controls applied to every export.

Recommended defaults:

1. **Biometric/health data:** `retentionPolicy: { strategy: 'timeboxed', maxAgeMs: 30 * 24 * 60 * 60 * 1000 }` plus an encryption hook that wraps payloads with AES-GCM via customer KMS.
2. **Analytics only:** `retentionPolicy: 'retain-until-deleted'` with optional signing metadata (no encryption required if data is anonymized).
3. **Regulated markets (HIPAA/GDPR):** Require encryption hooks, log broker signing headers, and periodic export verification using `telemetry.getAuditTrail()` vs. persisted vault records.

See [`DOCS/REMOTE_STORAGE_ENCRYPTION_TEMPLATES.md`](./REMOTE_STORAGE_ENCRYPTION_TEMPLATES.md) for concrete AES-GCM/KMS wrapper examples and envelope metadata guidance you can hand to partner engineering teams.

#### Request Signing Middleware

- **Baseline middleware.** `ProductTelemetryHarness` now exposes `registerRequestMiddleware` (surfaced via `AdaptiveInterfaceEngine.registerTelemetryRequestMiddleware`) so partners can enforce signing/authorization logic on every provider flush. Use `createRequestSigningMiddleware` when you need a structured payload containing method, endpoint, timestamp, event digest, and prior metadata for HMAC/KMS signing services.
- **Provider expectations.** Outbound providers (e.g., `HttpTelemetryProvider`, remote storage adapters) must implement `registerRequestMiddleware` and execute middleware before shipping payloads. This ensures license checks, consent state, and encryption metadata flow through partner signing services before any network hop.
- **Audit propagation.** Middleware results can append headers, override endpoints, or attach `metadata` (e.g., key IDs, signature algorithms). The compliance vault captures this metadata through provider audit hooks so export reviewers can confirm which signature path approved each batch.

### License Validation & Feature Gating

- **Centralized license state.** `createAdaptiveSDK` now instantiates (or accepts) a `LicenseManager` that validates license keys, orchestrates custom validators, and exposes a status history. The telemetry harness consumes this manager and blocks `identify`/`track` calls whenever the license is missing, expired, or rejected, recording `compliance.license.blocked` audit entries for downstream review.【F:src/product/licensing/LicenseManager.js†L1-L189】【F:src/product/ProductTelemetryHarness.js†L1-L240】
- **Bootstrap options.** Pass `license` or `licenseManager` into `createAdaptiveSDK` to preload license details, validators, and auto-validation behavior. The factory now returns helpers—`setLicense`, `validateLicense(context)`, `getLicenseStatus()`, `getLicenseHistory()`, `getLicenseAttestationHistory()`, `registerLicenseAttestationProfile()`, `getLicenseAttestationProfiles()`, `setDefaultLicenseAttestationProfile()`, `setLicenseAttestorFromProfile()`, `setLicenseAttestor()`, `requestLicenseAttestation()`, and `onLicenseStatusChange()`—so partner shells can refresh entitlements, observe live status updates, or trigger remote attestation checks during startup flows.【F:src/core/AdaptiveSDK.js†L1-L210】
- **Remote attestation pipeline.** Provide `license.attestor` (or top-level `licenseAttestor`) configuration to instantiate a `RemoteLicenseAttestor` with attestation, revocation, and entitlement endpoints. You can register reusable profiles via `licenseAttestationProfiles`/`registerLicenseAttestationProfile()` or import curated packs (`licenseAttestationProfilePackId`, `licenseAttestationProfilePacks`, or `registerLicenseAttestationProfilePack()`) from the catalog so commercialization teams ship enterprise/studio/indie defaults without hand-assembling endpoints. The telemetry harness subscribes to attestation events and records `compliance.license.attestation`, `compliance.license.attestor_error`, `system.license.attestation_scheduled`, and `system.license.attestation_profile_pack_registered` audit entries, ensuring compliance dashboards track every remote check, scheduling decision, and pack registration.【F:src/product/licensing/RemoteLicenseAttestor.js†L1-L253】【F:src/product/licensing/LicenseAttestationProfileRegistry.js†L1-L172】【F:src/product/licensing/LicenseAttestationProfileCatalog.js†L1-L302】【F:src/product/ProductTelemetryHarness.js†L1-L487】
- **Feature gating.** `LicenseManager.requireFeature(feature)` throws when entitlements are missing. Use this within optional modules (e.g., haptic packs) to deliver tier-specific upsells while ensuring telemetry remains compliant if a customer downgrades mid-session.【F:src/product/licensing/LicenseManager.js†L155-L189】

### Reusable Consent Panel Component
The consent UI inside `wearable-designer.html` now uses `createConsentPanel` (see `src/ui/components/ConsentPanel.js`). The component accepts consent options, telemetry hooks, and compliance vault accessors, rendering:

1. Toggle controls for each classification with automatic synchronization to the current consent snapshot.
2. A consent status summary listing enabled/disabled classifications and audit entry counts.
3. A compliance log preview with timestamped events.
4. A download action that exports the captured vault records.

Partners can reuse the component inside plug-ins or dashboards by passing their own DOM container, consent callbacks, and telemetry getters. Use `createAdaptiveSDK({ consentOptions }).createConsentPanel({ container, ... })` when bootstrapping the SDK to ensure default consent copy stays synchronized across surfaces. The component also exposes `handleConsentDecision` so external workflows (e.g., server acknowledgements) can drive UI updates.

## Sensor Validation Feedback
The `SensoryInputBridge` now publishes schema issues through three surfaces:
1. `sensoryBridge.setValidationReporter(fn)` – synchronous callback invoked whenever validation issues occur.
2. `sensoryBridge.getValidationLog()` – retrieves the rolling buffer of validation events.
3. `telemetry.recordSchemaIssue(issue)` – automatically invoked by `AdaptiveInterfaceEngine` to emit a `sensors.schema_issue` event with `compliance` classification.

Partners should use these signals to tie consent prompts or trust indicators back to raw hardware validation failures.

## Hardware Adapter Lifecycle
Sensor adapters can now implement optional `connect`, `disconnect`, and `test` methods. Use the new SDK wrappers to manage lifecycle state:

```js
const sdk = createAdaptiveSDK();

sdk.registerSensorAdapter('neural-intent', neuralAdapter);
await sdk.connectSensorAdapter('neural-intent');
const status = sdk.sensoryBridge.getAdapterState('neural-intent'); // { status: 'connected' }
```

`AdaptiveInterfaceEngine` emits telemetry events for registration, connection success, and failure paths (`sensors.adapter.*`), allowing downstream compliance tooling to verify adapter readiness before collecting biometric data.

## Implementation Checklist
- [x] Classify all telemetry events and gate analytics/biometric payloads behind consent.
- [x] Record consent changes and schema violations in an auditable log.
- [x] Expose adapter lifecycle hooks via the SDK and emit lifecycle telemetry.
- [x] Integrate UI consent prompts inside `wearable-designer.html` and expose a reusable component for partner plug-ins. *(Demo shell now packages the consent experience via `createConsentPanel`; partner kits can import the same module.)*
- [x] Provide remote persistence adapters (`createSignedS3StorageAdapter`, `createLogBrokerStorageAdapter`) so compliance teams can stream vault data into approved storage.
- [x] Add telemetry request signing middleware and harness/provider APIs to enforce outbound authentication.
- [x] Gate telemetry on active licenses and expose audit events for blocked usage through `LicenseManager` integration.
- [x] Wire remote attestation, revocation checks, and entitlement sync into the license manager/telemetry harness so audit logs capture each remote validation.
- [x] Publish curated license attestation packs and surface pack registration APIs/audit events through the telemetry harness and SDK.
- [x] Surface commercialization coverage summaries via `LicenseCommercializationReporter` so compliance dashboards can audit pack adoption, SLA ranges, and default profile changes straight from the telemetry harness/SDK.
- [x] Capture commercialization KPI snapshots + exports via `LicenseCommercializationSnapshotStore`, ensuring snapshot contexts omit license keys when `dataMinimization.omitLicense` is enabled, redacting `licenseKey` automatically in the remote storage adapters, and providing JSON/CSV exports for BI teams.【F:src/product/licensing/LicenseCommercializationSnapshotStore.js†L1-L238】【F:src/product/ProductTelemetryHarness.js†L468-L534】【F:src/product/licensing/storage/CommercializationSnapshotStorageAdapters.js†L1-L142】
- [ ] Extend schema validation reports to persist in long-term storage with partner-provided retention policies.

## Next Steps
1. Align with legal/privacy stakeholders on retention windows and cross-border data transfer policies for compliance telemetry.
2. Harden the remote storage adapters with encryption-at-rest options and signed deletion flows aligned to partner policies (iterate on the new templates after stakeholder review).
3. Provide partner-ready provider configurations that consume `registerTelemetryRequestMiddleware` and `createRequestSigningMiddleware`.
4. Socialize the new attestation profile catalog (payload templates, SLA defaults, registration examples) with partner onboarding teams and collect feedback for healthcare/education-specific packs.
5. Evaluate TypeScript adoption for `ProductTelemetryHarness` to surface classifications and consent APIs at compile time.
