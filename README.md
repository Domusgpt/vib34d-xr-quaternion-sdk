# VIB34D XR Quaternion SDK

**4D Geometric Processing with XR Quaternion Integration**

A focused SDK extracting VIB34D's quaternion mathematics and XR sensor integration for spatial computing applications. Compatible with OpenXR, WebXR, and standard XR development tools.

## 🎯 What This SDK Provides

### Core Quaternion & 4D Math
- **4D Polytope Systems**: Real-time projection of tesseracts, 120-cells, and other 4D geometries
- **Quaternion Mathematics**: Full quaternion algebra for XR rotations and 4D transformations
- **Geometric Processing**: Advanced polytopal projection and visualization
- **Quaternion Rotor Compute Pipeline**: WebGPU compute helper with CPU fallback for generating rotation matrices and XW/YW/ZW scalars.

### XR Integration Layer
- **Sensor Schema Registry**: Normalizes quaternion data from XR devices
- **AR Visor Adapter**: Processes spatial tracking and pose data
- **Shader Quaternion Synchronizer**: GPU-ready quaternion-to-matrix conversion
- **Quaternion Pose Registry Synchronizer**: Bridges the shared pose registry into shader parameter updates so headset/controller quaternions stay aligned across runtimes.
- **Pose Registry Ingestion**: `createAdaptiveSDK` now exposes a shared `poseRegistry`, automatically wiring `spatial.pose-frame` and `spatial.pose` channels into the quaternion device registry for downstream synchronizers.
- **Pose Reliability Monitor**: Optional `poseReliabilityMonitor` watches registry confidence, surfaces degraded/stale/lost devices, and emits telemetry recovery events.
- **Spatial Consensus Module**: `spatialConsensus` aggregates localization snapshots across participants, blending router channels and remote anchors into a consensus dual quaternion and rotor for shared experiences.
- **Sensory Input Bridge**: Centralizes XR sensor routing
- **WebXR Quaternion Bridge**: Streams XRFrame poses, rotor snapshots, and audio bands into the WebGPU glass composer
- **Glass Uniform Controller**: Centralizes localization ingestion, rotor fusion, and uniform ring updates for both preview and production WebXR pipelines
- **Predictive Rotor Cache**: Kalman-filtered rotor forecasting blended into the uniform controller for late-latching friendly quaternions and telemetry
- **Spatial Story Graph**: Plugin-driven trigger bus that reacts to localization drift, audio surges, and confidence dips to orchestrate emergent shader responses
- **Glass Pipeline Factory**: Builds reusable bind group layouts, pipelines, and samplers so preview and runtime harnesses share identical shading configuration.【F:src/ui/adaptive/renderers/webgpu/GlassPipelineFactory.ts†L1-L309】
- **WebXR Glass Session Harness**: Drives immersive sessions with triple-buffered uniforms, per-view layer targets, and XRGPUBinding management for WebGPU rendering.【F:src/ui/adaptive/renderers/webgpu/WebXRGlassSession.ts†L1-L329】
- **BufferLayout & Polytope Instance Buffer**: Std140/std430 layout planners plus instanced storage helpers that keep WebGPU uniforms and polytopes aligned across CPU and GPU paths.【F:src/ui/adaptive/renderers/webgpu/BufferLayout.ts†L1-L184】【F:src/ui/adaptive/renderers/webgpu/PolytopeInstanceBuffer.ts†L1-L139】
- **Localization Quaternion Fabric**: `LocalizationBridge`, `QuaternionFabricRouter`, and `RotorFusionService` capture provenance, confidence, and rotor fusion metrics for stage and anchor localization flows. The router now scores anchor channels with reliability/recency heuristics, exposes anchor summaries, and offers a `selectPreferredChannel` helper so shader synchronizers and layout engines can consistently target the healthiest anchor feed.【F:src/ui/adaptive/localization/LocalizationBridge.ts†L1-L323】【F:src/ui/adaptive/localization/QuaternionFabricRouter.ts†L1-L214】【F:src/ui/adaptive/localization/RotorFusionService.ts†L1-L140】

### Visualization Engines
- **Faceted System**: 2D pattern generation with 4D rotation controls
- **Quantum System**: 3D lattice structures with quaternion-driven transformations
- **Holographic System**: Audio-reactive visualizations with 4D hyperplane rotation
- **Polychora System**: Native 4D polytope rendering

### Commercial Features
- **License Manager**: Attestation profiles for enterprise/studio/indie tiers
- **Telemetry System**: Privacy-compliant event tracking
- **Telemetry Batching**: `ProductTelemetryHarness` ships a configurable `TelemetryBatcher` that coalesces events by size/age,
  retries transient failures, exposes `flushBatches`/`deliverBatch` helpers through the telemetry facade, and now supports
  browser lifecycle auto-flush triggers (visibility changes, page hides, unload) plus custom hooks so partners can guarantee
  delivery before XR shells tear down.
- **Commercialization Analytics**: KPI reporting and snapshot storage
- **Telemetry Facade**: Chainable `telemetryControls` wrappers for provider registration, consent updates, commercialization helpers, provider blueprint generation, and export-ready consent bundles.

```javascript
import { createAdaptiveSDK } from 'vib34d-xr-quaternion-sdk';

const sdk = createAdaptiveSDK({
  telemetry: {
    defaultConsent: { analytics: false },
    batch: {
      maxSize: 25,
      maxAgeMs: 7500,
      preferBatchedDelivery: true,
      autoFlush: {
        visibilityChange: true,
        pageHide: true,
        beforeUnload: true,
        custom: [flush => window.addEventListener('quaternion-session:end', () => void flush('session-end'))]
      }
    }
  }
});

// Telemetry facade mirrors harness helpers but returns the engine for easy chaining.
sdk.telemetryControls
  .registerTelemetryProvider(myProvider)
  .registerTelemetryRequestMiddleware(createSigningMiddleware());

// Batch utilities let you drain the queue before shutdown or after partner consent changes.
await sdk.telemetryControls.flushBatches({ reason: 'session-end' });

// You can also instantiate a standalone batcher when composing bespoke telemetry pipelines.
import { TelemetryBatcher } from 'vib34d-xr-quaternion-sdk/product/telemetry/batcher';
const batcher = new TelemetryBatcher({ maxBatchSize: 100, maxBatchAgeMs: 5000 });

// Snapshot utilities and audit helpers are accessible through the same facade.
const summary = sdk.telemetryControls.getCommercializationSummary();
const auditTrail = sdk.telemetryControls.getAuditTrail();

// Pose registry helpers expose normalized quaternion samples from sensory channels.
const poseRegistry = sdk.poseRegistry;
if (poseRegistry) {
  const headset = poseRegistry.getDevice('headset-primary');
  console.log('Headset reliability', headset?.reliability);
}

// Build a registry synchronizer that streams headset/controller quaternions into shaders.
const poseSynchronizer = sdk.createQuaternionPoseRegistrySynchronizer({
  minConfidence: 0.25,
  synchronizerOptions: {
    systems: {},
  },
});
poseSynchronizer.start();

// Pose reliability monitor keeps telemetry aware of degraded or stale devices.
sdk.poseReliabilityMonitor?.evaluate();

// Spatial consensus module blends localization snapshots across participants.
const consensusModule = sdk.spatialConsensus ?? sdk.createSpatialConsensusModule();
// `localizationSnapshotFromRemote` represents a LocalizationSnapshot produced by a remote participant.
consensusModule.ingest('guest-1', localizationSnapshotFromRemote);
const consensus = consensusModule.getConsensus({ anchorId: 'shared-stage' });
console.log('Consensus anchor', consensus?.anchorId, 'confidence', consensus?.confidence);
```

### Reference telemetry providers & consent bundles

Use the new `product/telemetry/reference-providers` export to register ready-to-use providers and generate blueprints/consent bundles that align with our documentation:

```javascript
import {
  registerReferenceTelemetryProviders,
  createReferenceTelemetryBlueprints
} from 'vib34d-xr-quaternion-sdk/product/telemetry/reference-providers';

const blueprints = createReferenceTelemetryBlueprints();
const registration = registerReferenceTelemetryProviders(sdk.telemetry, {
  http: { endpoint: 'https://telemetry.partner.example/collect' },
  consentBundle: { format: 'csv', metadata: { exportedBy: 'sdk-bootstrap' } }
});

console.log('Console provider retention days', blueprints.console.retentionDays);
console.log('Consent export format', registration.consentBundle?.format);
```

### TypeScript Support

- `types/adaptive-sdk.d.ts` ships alongside the runtime so partners get rich IntelliSense for `createAdaptiveSDK`, telemetry controls, and licensing helpers.
- The telemetry facade export (`vib34d-xr-quaternion-sdk/product/telemetry/facade`) now advertises matching declaration files, letting teams author middleware and providers without casting to `any`.
- Reference providers expose declarations via `vib34d-xr-quaternion-sdk/product/telemetry/reference-providers`, letting partner teams extend or override the sample catalog without manually copying event descriptors.
- Add `"moduleResolution": "bundler"` (already configured in this repo) and point your tooling at the published package to consume the declarations.

## 📂 Repository Structure

```
vib34d-xr-quaternion-sdk/
├── src/
│   ├── core/                          # Core SDK and engine systems
│   │   ├── AdaptiveSDK.js            # Main SDK interface
│   │   ├── AdaptiveInterfaceEngine.js # Adaptive orchestration
│   │   ├── PolychoraSystem.js        # 4D polytope engine
│   │   ├── EnhancedPolychoraSystem.js # Advanced 4D features
│   │   └── Visualizer.js             # Base visualizer system
│   │
│   ├── ui/adaptive/                   # XR & Sensor Integration
│   │   ├── SensoryInputBridge.js     # XR sensor coordination
│   │   ├── SpatialLayoutSynthesizer.js
│   │   ├── renderers/
│   │   │   ├── ShaderQuaternionSynchronizer.js  # 🔥 Core quaternion-shader bridge
│   │   │   ├── ProjectionFieldComposer.js
│   │   │   └── LayoutBlueprintRenderer.js
│   │   ├── sensors/
│   │   │   ├── SensorSchemaRegistry.js          # Quaternion schema normalization
│   │   │   ├── WearableDeviceManager.js
│   │   │   └── adapters/
│   │   │       ├── ARVisorWearableAdapter.js    # 🔥 XR pose processing
│   │   │       ├── BaseWearableDeviceAdapter.js
│   │   │       ├── BiometricWristWearableAdapter.js
│   │   │       └── NeuralBandWearableAdapter.js
│   │   └── simulators/
│   │       ├── ProjectionScenarioSimulator.js
│   │       ├── ProjectionScenarioCatalog.js
│   │       └── ProjectionScenarioValidator.js
│   │
│   ├── geometry/                      # Geometric mathematics
│   │   └── GeometryLibrary.js        # 4D geometry definitions
│   │
│   ├── physics/                       # 4D physics simulation
│   │   └── Polychora4DPhysics.js
│   │
│   ├── quantum/                       # Quantum visualization system
│   │   └── QuantumEngine.js
│   │
│   ├── holograms/                     # Holographic system
│   │   └── RealHolographicSystem.js
│   │
│   └── product/                       # Commercial features
│       └── licensing/
│           ├── LicenseManager.js
│           ├── RemoteLicenseAttestor.js
│           ├── LicenseAttestationProfileRegistry.js
│           ├── LicenseAttestationProfileCatalog.js
│           ├── LicenseCommercializationReporter.js
│           ├── LicenseCommercializationSnapshotStore.js
│           └── storage/
│               └── CommercializationSnapshotStorageAdapters.js
│
└── DOCS/                              # Complete documentation suite
    ├── QUATERNIONS_IN_XR.md          # 🔥 XR quaternion integration guide
    ├── QUATERNION_VISUALIZER_AND_XR_LOCALIZATION_RESEARCH.md
    ├── SDK_BOUNDARY_PROPOSAL.md
    ├── ADAPTIVE_SDK_DEVELOPER_HANDOFF_GUIDE.md
    ├── 1-TECHNICAL-OVERVIEW.md
    ├── 3-DEVELOPER-GUIDE.md
    ├── wearables-platform-comparison.md
    ├── LICENSE_ATTESTATION_PROFILE_CATALOG.md
    ├── LICENSE_COMMERCIALIZATION_ANALYTICS.md
    └── ... (17 comprehensive docs)
```

## 🛠 Development Environment

```bash
corepack enable
pnpm install
pnpm dev:web      # Vite quaternion preview workbench
pnpm storybook    # Storybook quaternion preview states
pnpm codegen:localization  # Emit localization uniform bindings (TS/WGSL/C#)
```

Node.js 18.19+ is required (`.nvmrc` pins the recommended runtime) and pnpm enforces engine compatibility via `.npmrc`.

### WebGPU Glass Composer Preview

Running `pnpm dev:web` now launches a WebGPU-backed preview harness that:

- Instantiates the five-layer `MultiLayerGlassComposer` with HDR intermediate targets.
- Streams synthetic XR poses through the `GlassUniformController` + `WebXRQuaternionBridge` stack so quaternion sliders immediately affect the WebGPU renderer.
- Visualizes audio-reactive layer blending, rotor-driven hue shifts, and highlights any configuration risks (texture size, HDR formats) surfaced by the composer.
- Runs the shared `LayerBlurHelper` separable Gaussian blur passes at half resolution so preview output mirrors the multi-pass blur the XR runtime uses before compositing.【F:src/ui/adaptive/renderers/webgpu/LayerBlurHelper.ts†L1-L187】【F:src/ui/adaptive/renderers/webgpu/SeparableBlurPipeline.ts†L1-L127】
- Ports the hypersphere/hypertetrahedron lattice shader to WGSL via the `GlassShaderLibrary`, letting each layer select its own geometry/projection pair while keeping the WebGPU pipeline in sync with the legacy WebGL preview.
- Exposes geometry and projection selectors that rebuild the WebGPU pipelines or WebGL fallback so designers can compare lattice blends without reloading the sandbox.【F:src/dev/quaternionPreview.ts†L112-L160】【F:src/dev/quaternionPreview.ts†L312-L400】
- Ships a curated preset library alongside per-layer material controls for colors, pattern/glitch intensity, and lattice densities so the preview tweaks the same uniform data the WGSL pipelines and WebGL fallback consume.【F:src/dev/previewPresets.ts†L1-L212】【F:src/dev/quaternionPreview.ts†L408-L720】【F:src/dev/webgpuPreviewHarness.ts†L198-L360】【F:src/dev/webglFallbackPreview.ts†L1-L360】
- Persists geometry, projection, material, and system selections to local storage so preview sessions resume with identical parameters across reloads—mirroring how runtime operators will tune the quaternion-driven renderer.【F:src/dev/quaternionPreview.ts†L440-L536】【F:src/dev/previewStateStorage.ts†L1-L109】
- Exports shareable preview state JSON and restores pasted payloads with validation so teams can trade exact configurations across devices without re-tuning sliders by hand.【F:src/dev/quaternionPreview.ts†L1209-L1432】【F:src/dev/previewStateStorage.ts†L1-L142】
- Mirrors the same pipeline layouts consumed by the `WebXRGlassSession`, making desktop preview output match immersive headset rendering paths.【F:src/ui/adaptive/renderers/webgpu/WebXRGlassSession.ts†L1-L329】【F:src/dev/webgpuPreviewHarness.ts†L1-L818】
- Displays predictive rotor horizon/confidence metrics from the shared cache and surfaces active story graph triggers so designers see how emergent behaviors influence the five-layer composer in real time.【F:src/dev/webgpuPreviewHarness.ts†L1-L420】【F:src/dev/quaternionPreview.ts†L1-L420】

## 🚀 Key Integration Points

### XR Quaternion Pipeline

```javascript
// 1. Sensor Schema Layer - Normalizes XR poses
SensorSchemaRegistry.normalize(xrPose);

// 2. AR Visor Adapter - Processes spatial tracking
ARVisorWearableAdapter.processSpatialTrace(pose);

// 3. Sensory Input Bridge - Routes quaternion channels
SensoryInputBridge.distributeQuaternionChannels(data);

// 4. Shader Synchronizer - GPU updates
ShaderQuaternionSynchronizer.updateUniforms(quaternion);
```

### 4D Rotation Control

All visualization systems share quaternion-driven 4D rotation:
- `rot4dXW` - Rotation in XW plane
- `rot4dYW` - Rotation in YW plane
- `rot4dZW` - Rotation in ZW plane

These map directly to XR device orientations via `ShaderQuaternionSynchronizer`.

When the runtime switches between faceted, quantum, or holographic engines the `CanvasManager` now dispatches `vib34d:system-activated` / `vib34d:system-deactivated` events. The `ShaderQuaternionSynchronizer` listens for those and only streams quaternion updates into the active system, preventing multiple heavy canvases from competing for WebGL/WebGPU resources. To guard against environments that do not emit those lifecycle events, the synchronizer also enforces a single active target by default—you can opt into multi-system streaming by passing `maxActiveSystems` when constructing it. The preview harness mirrors this exclusivity with a radio selector so you can swap the active visualization system without spinning up concurrent canvases. The same manager now watches viewport and orientation changes, resizes the live canvas stack, and notifies the active engine so fidelity stays consistent when users rotate a headset or resize the host window.

## ✅ Quality Automation

- **Coverage Enforcement**: `vitest` now enforces project-wide line and branch minimums; CI runs `pnpm exec vitest run --coverage` so regressions fail immediately when tests slip below the thresholds.【F:vitest.config.ts†L1-L20】【F:.github/workflows/ci.yml†L1-L60】
- **Bundle Guardrail**: `pnpm run check:bundle` builds the SDK to `dist-ci/` and fails if Web deliverables exceed the configured size ceiling, keeping headset builds lean.【F:tools/ci/bundleSizeCheck.mjs†L1-L156】【F:package.json†L56-L66】
- **CI Pipeline**: GitHub Actions installs dependencies, runs the TypeScript smoke test, enforces coverage, and executes the bundle-size audit on every push and pull request.【F:.github/workflows/ci.yml†L1-L60】

## 📖 Documentation

See `DOCS/` directory for complete technical documentation:

**Core Integration Guides:**
- `QUATERNIONS_IN_XR.md` - XR quaternion mathematics and OpenXR/WebXR integration
- `QUATERNION_VISUALIZER_AND_XR_LOCALIZATION_RESEARCH.md` - Research and implementation details
- `ADAPTIVE_SDK_DEVELOPER_HANDOFF_GUIDE.md` - Complete developer handoff guide

**Technical References:**
- `1-TECHNICAL-OVERVIEW.md` - System architecture
- `3-DEVELOPER-GUIDE.md` - API reference and code examples
- `SDK_BOUNDARY_PROPOSAL.md` - SDK scope and module boundaries

**Platform Compatibility:**
- `wearables-platform-comparison.md` - OpenXR, WebXR, platform-specific details

**Commercial Features:**
- `LICENSE_ATTESTATION_PROFILE_CATALOG.md` - Licensing tiers
- `LICENSE_COMMERCIALIZATION_ANALYTICS.md` - Analytics and reporting
- `TELEMETRY_PRIVACY_AND_CONSENT_GUIDE.md` - Privacy compliance

## 🔧 Usage

This SDK is designed for integration into XR applications that need:
- Advanced quaternion mathematics for spatial computing
- 4D geometric visualization and projection
- Normalized sensor input from multiple XR platforms
- GPU-optimized quaternion-to-matrix conversion

See `DOCS/ADAPTIVE_SDK_DEVELOPER_HANDOFF_GUIDE.md` for complete integration instructions.

## 🌟 Key Technologies

- **4D Projection Mathematics**: True 4D geometric processing
- **Quaternion Algebra**: Complete implementation for XR rotations
- **OpenXR Compatible**: Works with standard XR development tools
- **WebGL Optimized**: GPU-ready shader integration
- **Modular Architecture**: Use only what you need

## 📝 License

See `DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md` for licensing options.

---

# 🌟 A Paul Phillips Manifestation

**Send Love, Hate, or Opportunity to:** Paul@clearseassolutions.com
**Join The Exoditical Moral Architecture Movement today:** [Parserator.com](https://parserator.com)

> *"The Revolution Will Not be in a Structured Format"*

---

**© 2025 Paul Phillips - Clear Seas Solutions LLC**
**All Rights Reserved - Proprietary Technology**

**Pioneering 4D Geometric Processing & XR Spatial Intelligence**
