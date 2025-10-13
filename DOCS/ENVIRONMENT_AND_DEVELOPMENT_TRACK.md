# Vib3 XR Quaternion SDK – Environment Setup & Development Track

This guide consolidates the immediate environment requirements and a staged development plan for integrating the Vib3 shader systems (faceted, quantum, holographic) with quaternion-driven XR pipelines. It is organized so the team can spin up a consistent workspace, align on the core architecture, and progress through a prioritized backlog that maximizes reuse of the shared quaternion math infrastructure.

---

## 1. Environment & Tooling Baseline

### 1.1 Core Runtime Requirements
- **Node.js 18 LTS or newer** (repository targets ES modules). Verify via `node --version`.
- **Package manager**: npm (bundled) or pnpm 8+. Run `npm install` at the repo root to hydrate dependencies.
- **TypeScript-aware IDE** (VS Code + ESLint/Prettier recommended) for modern ECMAScript support even though the project ships JS today.

### 1.2 XR & Graphics Toolchain
| Purpose | Recommended Tooling |
| --- | --- |
| Web-based prototyping & deployment | Chrome (WebXR enabled), Firefox 141+, Safari 18+, plus the WebXR Device Emulator extension for desktop testing. |
| GPU debugging & shader iteration | WebGPU-enabled Chrome Canary or Firefox Nightly; RenderDoc for native builds. |
| Unity pipeline | Unity 6 LTS with OpenXR plugin, Meta XR All-in-One SDK (v66+), Apple PolySpatial package (for visionOS). |
| Native web build & bundling | Vite or Webpack 5 if bundling is required later. |
| Mobile XR device ops | Meta Oculus Developer Hub, Xcode 16 with Reality Composer Pro, Android Platform Tools. |

### 1.3 Optional Enhancements
- **pnpm workspace** config for future multi-package setups.
- **Git hooks** (Husky) for linting/formatting.
- **Continuous Integration** template (GitHub Actions) executing lint/unit tests once they exist.

> **Tip:** Pre-create `.nvmrc` with the targeted Node version to enforce consistency during onboarding.

---

## 2. Architectural North Star

### 2.1 Existing Building Blocks
- `SensoryInputBridge` already normalizes heterogeneous XR and wearable inputs into semantic channels (`spatial.pose`, `spatial.anchors`, `spatial.hit-tests`).【F:src/ui/adaptive/SensoryInputBridge.js†L1-L118】
- `ShaderQuaternionSynchronizer` consumes those channels, converts quaternions to Euler-driven 4D rotation parameters, and feeds the faceted, quantum, and holographic systems.【F:src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js†L1-L118】
- `AdaptiveSDK` wires telemetry, licensing, and layout synthesis but currently delegates system resolution to injected objects.【F:src/core/AdaptiveSDK.js†L1-L83】

### 2.2 Target Core Architecture
1. **Quaternion Service Layer** – Introduce a dedicated module (e.g., `QuaternionFieldService`) responsible for:
   - Maintaining double-isoclinic rotations (left/right quaternion pairs) for 4D transforms.
   - Publishing derived shader uniforms via observers to reduce redundant conversions.
   - Exposing CPU-side math utilities shared by compute shaders and CPU consumers.
2. **Unified XR Pose Adapter** – Extend `SensoryInputBridge` with platform profiles so WebXR, OpenXR, and custom wearables map to a single schema (`{orientationQuat, position, confidence}`) before fan-out.
3. **Visualization Contracts** – Define an interface (TypeScript declaration or JSDoc) the faceted, quantum, and holographic systems implement (`updateParameter(name, value, context)` plus `batchUpdate(map)`), enabling the synchronizer to broadcast parameter changes atomically.
4. **Compute/Shader Abstraction** – Plan for a neutral shader data transport (UBOs/SSBOs for WebGPU/WebGL2, StructuredBuffers in Unity) so the same quaternion payloads drive GPU workloads regardless of runtime. Provide serialization helpers next to the quaternion service.
5. **Telemetry & Diagnostics Hook** – Use AdaptiveSDK’s telemetry plumbing to record quaternion latency, dropped frames, and confidence weighting for future optimization.

This architecture ensures quaternion computation stays centralized while visualization systems remain pluggable.

---

## 3. Refactoring & Development Track

| Phase | Objective | Key Activities | Deliverables |
| --- | --- | --- | --- |
| **0. Environment Stabilization** | Guarantee every contributor can run the stack. | Create `.nvmrc`, add setup script (`npm run setup`), document device provisioning (Quest, Vision Pro). | Updated README Quickstart, onboarding checklist. |
| **1. Quaternion Core Extraction** | Build the shared service layer. | Refactor quaternion utilities from synchronizer into `QuaternionFieldService`; add math helpers for dual-quaternion / rotor composition; write unit tests. | `src/core/quaternions/QuaternionFieldService.js`, test coverage. |
| **2. XR Input Harmonization** | Normalize pose data across platforms. | Extend `SensorSchemaRegistry` with WebXR/OpenXR schemas; implement adapters for Quest (OpenXR), Vision Pro (simd_quatf), desktop simulators. | Schema definitions, adapter docs, integration examples. |
| **3. Visualization Contract Alignment** | Ensure shader systems consume quaternion payloads consistently. | Update faceted/quantum/holographic systems to implement shared interface; add batching API; document expected parameter ranges and smoothing rules. | Interface spec, updated systems, sample integration snippet. |
| **4. GPU Pipeline Optimization** | Minimize per-frame overhead. | Implement shared uniform buffer updates, optional WebGPU compute pass, Unity compute shader equivalents; profile latency and frame time. | Performance benchmarks, shader uniform module, profiling reports. |
| **5. Interaction & Haptics Layer** | Map gestures and haptics onto 4D rotations. | Add gesture recognizers, map controller pairs to left/right rotors, integrate haptic feedback triggers, expose configuration in AdaptiveSDK. | Gesture module, haptics integration guide. |
| **6. QA & Deployment** | Harden release path. | Automated tests, CI pipelines, documentation updates, release tagging, demo scenes for each runtime. | CI workflow, release notes, sample XR experiences. |

Each phase should exit with runnable demos (WebXR + Unity), profiling notes, and documentation updates.

---

## 4. Immediate Next Steps Checklist
- [x] Add `.nvmrc` and `npm run setup` script to codify environment.
- [x] Draft `QuaternionFieldService` skeleton with observer pattern and serialization helpers.
- [x] Document XR schema extensions (`DOCS/XR_SCHEMA_GUIDE.md`) now that the WebXR/OpenXR normalizers are in place.
- [x] Formalize the visualization parameter contract and batch-update path across the faceted, quantum, and holographic systems.
- [ ] Schedule profiling runs on Quest 3 (72/90 FPS) and Vision Pro simulator after Phase 4.
- [ ] Establish knowledge base pages for faceted, quantum, holographic parameter mapping.

---

## 5. Supporting Documentation Roadmap
Create or expand the following docs as work progresses:
- **Quaternion Service Guide** – Implementation notes for the shared quaternion layer.
- **Shader Integration Cookbook** – WebGL/WebGPU/Unity shader snippets demonstrating quaternion uniform usage.
- **Interaction Design Playbook** – Gesture, gaze, and haptic mapping reference.
- **Performance Matrix** – Device-specific budgets, profiling data, recommended FFR/LOD settings.

Maintaining these artifacts alongside code ensures the quaternion-focused architecture remains cohesive as the Vib3 systems evolve.

---

### Contact & Ownership
- **Technical Owner:** Quaternion systems team (initially Paul Phillips / Clear Seas Solutions).
- **Documentation Steward:** Assign to onboarding lead once Phase 0 completes.

Aligning on this setup and development cadence will keep the Vib3 shader systems performant, maintainable, and ready for multi-platform XR deployment.
