# Vib3 XR Quaternion Integration — Environment Setup & Development Track

This guide consolidates the environment preparation, tooling, and phased development strategy required to integrate the Vib3 faceted, quantum, and holographic shader systems with XR quaternion pipelines efficiently. It expands on the existing developer guide with XR-first workflows, ensures quaternion data is shared coherently across runtimes, and lays out a refactoring track for achieving a unified 4D-capable architecture across web, Unity, and native spatial platforms.

---

## 1. Core Objectives

1. **Establish reproducible environments** for WebXR/WebGPU, Unity (Quest-class), and visionOS builds that share common quaternion math libraries and shader modules.
2. **Refactor runtime architecture** around a quaternion-centric data core that feeds both CPU-side simulation and GPU shader systems with minimal conversion overhead.
3. **Create a development track** that sequences platform bring-up, shader integration, performance tuning, and QA automation for long-term maintainability.

---

## 2. Environment Baselines

### 2.1 Toolchain Versions

| Layer | Required Versions | Notes |
| --- | --- | --- |
| Node.js toolchain | Node 18 LTS (>=18.19), pnpm 9.x, TypeScript 5.5 | Aligns with ES2022 modules already used in `package.json` and allows WebGPU build tooling. |
| Web build tooling | Vite 5.x, esbuild 0.21+, GLSLify 7.x | Vite dev server + rollup pipeline for hot reload and shader includes. |
| XR browsers | Chrome 126+, Firefox 141+, Safari 17.4+ (with WebXR/WebGPU flags), Quest Browser 32+ | Enables WebXR + WebGPU parity in 2025 hardware. |
| Unity | Unity 6 LTS (2025.1) + Meta XR All-in-One SDK 62.0, PolySpatial 1.2 for visionOS export | Provides compute shaders, late latching, and PolySpatial bridge. |
| Native tooling | Xcode 16.1 (visionOS 2 SDK), Android Studio Iguana (API 34) | For native plugins and validation tooling. |
| Testing & profiling | Oculus Developer Hub 3.5, Chrome DevTools WebXR Emulator, Xcode Instruments, RenderDoc 1.30 | Required for perf baselines on each platform. |

### 2.2 System Dependencies

- GPU with WebGPU support (Metal/DirectX12/Vulkan).
- Quest 3 (or XR2 Gen 2 class) headset for mobile XR validation.
- Optional: Apple Vision Pro or simulator for PolySpatial testing.
- High-speed Wi-Fi 6/6E for multi-user latency experiments.

---

## 3. Repository Setup

1. **Clone & install**
   ```bash
   git clone git@github.com:Domusgpt/vib34d-xr-quaternion-sdk.git
   cd vib34d-xr-quaternion-sdk
   corepack enable              # enables pnpm via Corepack
   pnpm install                 # installs dev tooling (adds lockfile)
   ```
2. **Bootstrap dev scripts** (add to `package.json`):
   - `dev:web`: `vite --open`
   - `build:web`: `vite build`
   - `lint`: `eslint "src/**/*.{js,ts}"`
   - `test`: `vitest run`
   - `analyze:bundle`: `vite build --mode analyze`
3. **Optional Unity submodule** (for shared shader/math package):
   ```bash
   git submodule add git@github.com:Domusgpt/vib3-xr-unity-integration.git unity
   ```
4. **Environment files**
   - `.nvmrc` → `v18.19.0`
   - `.npmrc` → `engine-strict=true`, `fund=false`
   - `pnpm-workspace.yaml` → declare `packages:
      - "src/**"
      - "unity/Packages/*"`

---

## 4. Quaternion-Centric Architecture Blueprint

### 4.1 Shared Math Core

- **Create `src/core/quaternion/index.ts`** exporting pure math utilities (lerp, slerp, dual quaternions, rotors) consumed by:
  - `ShaderQuaternionSynchronizer` (WebGL/WebGPU renderer).【F:src/core/AdaptiveSDK.js†L1-L13】
  - Unity compute shaders via generated `.hlsl`/`.glsl` from same source (use `glslang` transpilation step).
  - Native Swift/Kotlin layers through code generation (e.g., `simd_quatf` wrappers).
- Provide WGSL/GLSL snippets via tagged template exports for direct shader inclusion.

### 4.2 Data Flow

1. **Pose ingestion layer** (XR inputs, gestures, networking) normalizes quaternions to left-handed coordinate system with metadata (timestamp, reliability).
2. **Quaternion registry** maintains double-buffered state per device (headset, controllers, hands) and exposes uniform buffers for GPU ingestion.
3. **4D rotor composer** maps dual quaternions to left/right rotor factors, deriving six-plane weights (XY, XZ, XW, YZ, YW, ZW).
4. **Shader binding layer** streams quaternion buffers to WebGPU bind groups / Unity GraphicsBuffer with late-latched updates.
5. **Visualizer modules** (faceted, quantum, holographic) consume same rotor output to drive geometry, particle systems, and audio reactivity.

### 4.3 Build Targets

| Target | Renderer | Math binding | Asset packaging |
| --- | --- | --- | --- |
| WebXR/WebGPU | Three.js + R3F or custom WebGPU renderer | ES module math core → WGSL via `codegen/quaternion.wgsl` | Vite asset manifest, progressive Draco meshes |
| Unity Quest | URP single-pass instanced | Shared math via `.cginc` generated from core | Addressables for polytope sets, ASTC textures |
| visionOS PolySpatial | RealityKit translated shaders | Math core generates MaterialX snippet | USDZ + Reality Composer Pro scenes |

---

## 5. Refactoring & Development Track

### Phase 0 — Discovery & Tooling (Week 0-1)
- Finalize Node/pnpm adoption, add lint/test scripts, generate initial lockfile.
- Audit existing modules (e.g., `AdaptiveInterfaceEngine`, `ShaderQuaternionSynchronizer`) to map dependencies and identify duplication.【F:src/core/AdaptiveSDK.js†L1-L88】
- Stand up Vite dev server + Storybook (optional) for shader previews.

### Phase 1 — Quaternion Core Extraction (Week 1-3)
- ✅ Refactor current quaternion helpers into shared math package with unit tests (Vitest + Jest snapshot for rotor matrices).
- ✅ Implement JSON schema for XR pose payloads (head, controllers, hands) with validation.
- ✅ Provide conversion utilities (Quaternion ↔ matrix ↔ rotor) and add benchmarks.
- 🔄 Wire `ShaderQuaternionSynchronizer` to shared quaternion math + pose registry primitives and expand test harness coverage.

### Phase 2 — WebXR/WebGPU Integration (Week 3-6)
- ✅ Document WebGPU migration architecture and land the `MultiLayerGlassComposer` + `TripleBufferedUniform` scaffolding for the glassmorphic renderer.
- ✅ Build WebGPU compute pipeline for 4D preprocessing (WGSL generated from math core) via `QuaternionRotorCompute`, including CPU parity helpers for non-WebGPU environments.
- ✅ Integrate React Three Fiber layer (or custom renderer) with `useXR()` bridge feeding shader uniforms via the new `WebXRQuaternionBridge` that streams viewer poses, rotor math, and audio bands into the glass composer.
- ✅ Introduce a shared `GlassUniformController` that ingests localization snapshots, performs rotor fusion smoothing, and writes glass uniforms so the preview harness and future WebXR session code share one orchestration layer.
- ✅ Add UBO/SSBO management with std140/std430 layouts and instancing for polytopes via the shared `BufferLayout` helpers and `PolytopeInstanceBuffer` storage manager.
- ✅ Ship developer sandbox page for runtime parameter tweaking (WebGPU preview harness with quaternion sliders feeding the composer).
- ✅ Port the hypersphere/hypertetrahedron lattice shader suite to WGSL with the reusable `GlassShaderLibrary`, keeping WebGPU layer pipelines in lockstep with the legacy WebGL preview.

### Phase 3 — Unity XR Pipeline (Week 6-10)
- Create Unity package referencing math core via shared artifacts (e.g., `Packages/com.vib3.quaternion`).
- Implement compute shader path for rotor preprocessing and late-latched instanced rendering.
- Integrate Meta Haptics SDK events mapped to rotor plane transitions.
- Establish automated Quest build using `game-ci/unity-builder` GitHub Actions.

### Phase 4 — Native Spatial Extensions (Week 10-14)
- PolySpatial shader compatibility pass; generate MaterialX with simplified math fallback.
- Kotlin Spatial SDK prototype using shared quaternion core compiled to WASM/native.
- Implement XR multi-user sync (Photon / WebSocket) serializing rotor components.

### Phase 5 — Performance & QA Hardening (Week 14-18)
- Automated perf harness: Web (Playwright + WebXR emulator), Unity (Profiler markers), native (Instruments).
- Thermal/LOD tests with scripted sweeps controlling shader complexity and polygon counts.
- Regression testing for quaternion math (fuzz tests, property-based with `fast-check`).
- Accessibility + alternative input validation (gaze-only, voice commands).

### Phase 6 — Release & Documentation (Week 18-20)
- Produce runtime configuration cookbook, onboarding tutorials, and troubleshooting matrix.
- Finalize CI/CD: lint → unit tests → shader compile check → bundle/build → deploy to staging buckets/Quest App Lab internal channel.

---

## 6. Automation & Observability

- **CI Pipelines**
  - GitHub Actions workflows for `web`, `unity`, `native`. Each caches pnpm, Unity Library, Xcode derived data.
  - Static analysis: ESLint, Stylelint, cspell, markdownlint.
  - Shader compile check: `glslangValidator`, `wgsl-analyzer`, Unity shader warmup job.
- **Telemetry Hooks**
  - Extend existing telemetry engine to log quaternion latency (sensor timestamp → shader submission) and rotor plane usage distribution.
  - Export GPU frame timings via WebGL/Unity XR stats APIs for A/B testing.
- **Crash & Issue Tracking**
  - Sentry for web, Unity Cloud Diagnostics for Quest, MetricKit for visionOS.

---

## 7. Developer Operations Checklist

- [ ] Run `pnpm install` and verify Vite dev server launches at `http://localhost:5173` with WebXR polyfill fallback.
- [ ] Attach Quest 3 via Oculus Developer Hub; confirm WebXR build hits 90 FPS baseline scene.
- [ ] Validate Unity project builds to Quest using single-pass instanced render path.
- [ ] Execute `pnpm test` quaternion suite on every commit (ensure deterministic math outputs).
- [ ] Record baseline RenderDoc captures for each target platform to validate uniform buffer bindings.

---

## 8. Knowledge Base Roadmap

- Update `DOCS/3-DEVELOPER-GUIDE.md` to reference this setup guide and link shader math core docs.
- Add `docs/platform-playbooks/` directory with per-platform deployment steps.
- Produce video walkthroughs for environment bring-up (web + Quest + visionOS).

---

## 9. Localization Quaternion Fabric

To keep quaternion localization consistent across heterogeneous XR runtimes we introduce a **Localization Quaternion Fabric (LQF)**—a lightweight service mesh that binds shared math primitives with platform-aware localization adapters.

### 9.1 Fabric Principles

- **Quaternion Provenance Channels** — every quaternion entering the fabric is tagged with its origin (sensor, SLAM, shared anchor) and localization space. This metadata travels with the quaternion buffer so late-latching, replay, or prediction never loses context.
- **Dual-Space Synchronization** — maintain paired dual quaternions representing local pose (device → world) and global anchor (world → shared stage) so localization layers can mix-and-match depending on platform capabilities.
- **Rotational Confidence Heuristics** — compute angular velocity variance, jitter, and drift coefficients which are later used to weight rotor contributions when driving visualizers or physics.

### 9.2 Fabric Components

| Component | Responsibility | Implementation Notes |
| --- | --- | --- |
| `LocalizationBridge` | Normalizes incoming localization frames (ARKit, OpenXR Stage, Spatial Anchors) and produces paired dual quaternions. | Lives beside `SensorSchemaRegistry`, reuses math core conversions. |
| `QuaternionFabricRouter` | Manages provenance channels, double-buffering, and priority arbitration for late frames. | Implement as lightweight event emitter with time-sorted queues (JS) and `NativeQueue` (Unity/Swift). |
| `RotorFusionService` | Composes localized dual quaternions with 4D rotor weights to drive adaptive visualizers. | Reuses `4D rotor composer` pipeline; adds weighting matrix derived from localization confidence. |
| `SpatialConsensusModule` | Performs multi-user localization reconciliation (shared anchors, world-locking). | For web, leverage WebRTC DataChannel; on Unity, wrap Photon/Netcode for GameObjects. |

### 9.3 Localization Code Generation

- Add `tools/codegen/localization-quaternions.ts` that reads schema definitions and emits:
  - TypeScript bindings with discriminated unions for localization sources.
  - WGSL structs with matching layout for GPU-friendly localization buffers.
  - C#/Swift extensions mapping to `Unity.Mathematics.quaternion` / `simd_quatf`.
- Integrate the codegen step into `pnpm build:web` and the Unity package pre-build hook so localization math stays in sync.

---

## 10. Dynamic Emergent Utility Track

The fabric unlocks emergent behaviors by letting visualization and systems layers subscribe to localization-aware quaternion streams.

### 10.1 Adaptive Experience Layers

1. **Spatial Story Graph** — maintain graph of anchors, rotors, and triggers. Graph traversal decides which subsystem (faceted, quantum, holographic) should respond to pose deltas.
2. **Procedural Interaction Seeds** — use localization confidence and drift metrics to spawn adaptive shaders or audio cues when tracking changes (e.g., blend holographic trails when drift exceeds threshold).
3. **Predictive Rotor Caching** — GPU prefetch of rotor states based on motion prediction, minimizing stalls when users rapidly re-localize between rooms.

### 10.2 Emergent Scenario Templates

- **Shared Stage Co-Creation** — combine multiple user rotors via `SpatialConsensusModule`; orchestrate collective geometry manipulation when localization agreement passes confidence threshold.
- **Localization Failure Graceful Degradation** — if localization confidence drops, automatically blend to procedural 4D abstractions while sensors recover, avoiding jarring snaps.
- **Dynamic Anchor-Informed Audio** — map anchor stability to quantum engine audio modulation so scenes feel grounded or fluid depending on localization certainty.

---

## 11. Implementation Milestones (Week 20-28)

1. **Week 20-22 — Fabric Scaffolding**
   - ✅ Implement `LocalizationBridge` with ARKit/OpenXR adapters and hook into existing sensor registry via the localization fabric modules.【F:src/ui/adaptive/localization/LocalizationBridge.ts†L1-L323】
   - ✅ Establish provenance tagging schema and write Vitest suites validating serialization/deserialization for stage/anchor snapshots.【F:tests/localizationFabric.test.ts†L1-L97】
2. **Week 22-24 — Rotor Fusion & Confidence Metrics**
   - ✅ Ship `RotorFusionService`, generating 4D rotor weights informed by localization statistics and feeding the WebGPU bridge’s rotor override path.【F:src/ui/adaptive/localization/RotorFusionService.ts†L1-L140】【F:src/dev/webgpuPreviewHarness.ts†L662-L742】
   - ✅ Add GPU integration path (WGSL/Unity compute) for localization buffers, ensuring synchronization with shader uniform layouts and the preview harness risk surface.【F:src/ui/adaptive/renderers/webgpu/BufferLayout.ts†L200-L245】【F:src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts†L17-L239】
3. **Week 24-26 — Emergent Layer Enablement**
   - Build spatial story graph service with plug-in triggers for visualizer subsystems.
   - Prototype predictive rotor caching using Kalman-filtered quaternion extrapolation.
4. **Week 26-28 — Multi-User & QA**
   - Integrate `SpatialConsensusModule` with networking layer; run multi-user localization soak tests.
   - Expand QA harness to include localization drift simulations and automated failover validation.

---

## 12. Documentation & Developer Experience Enhancements

- Produce localization quaternion primer in `DOCS/QUATERNIONS_IN_XR.md` linking to the fabric design, including sample code for provenance tagging.
- ✅ Update developer sandbox with live localization confidence overlays and rotor fusion metrics surfaced in the WebGPU preview harness risk panel.【F:src/dev/webgpuPreviewHarness.ts†L598-L742】
- Record guided walkthrough showing how emergent scenarios respond to localization shifts across WebXR, Unity, and visionOS builds.

---

By extending the development track with the Localization Quaternion Fabric and emergent utility layers, the SDK gains a novel architecture that keeps localization data coherent while enabling dynamic experiences across XR platforms.

---

By following this environment setup and phased development plan, the Vib3 shader systems can evolve into a unified XR platform that leverages shared quaternion math across web, Unity, and native spatial runtimes while maintaining real-time performance and maintainable tooling.
