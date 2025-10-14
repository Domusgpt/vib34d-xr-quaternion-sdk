# Quaternion Alignment for XR Wearables

## Why Quaternions Matter in XR
Quaternions are the de-facto representation for XR orientation because they avoid the gimbal lock and interpolation artefacts that plague Euler angles. OpenXR and WebXR expose headset, controller, and spatial anchor poses as `position` + `orientation` objects, where the orientation is always a unit quaternion. This encoding powers:

- **Headset and Controller Tracking** – Every `XRSpace` pose, action pose, and hand joint is expressed as a quaternion so runtimes can smoothly compose device motion, origin offsets, and stage references.
- **Spatial Mapping** – Anchors, hit-test results, and detected planes carry quaternions to lock world-aligned normals and tangents, ensuring scene understanding survives re-localisation and drifting sensors.
- **Camera & View Rendering** – View matrices are derived from quaternion orientations so the rendered frustum matches the user’s head pose without accumulating floating-point drift.

## Current Runtime Touchpoints
Our wearables stack already threads quaternion data through the full ingestion path:

- **Schema Normalisation** – `SensorSchemaRegistry` enforces quaternion shape and normalisation for wearable poses, spatial planes, hit-test results, and anchors so downstream systems always receive the canonical `x/y/z/w` tuple.【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L520-L533】【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L880-L909】【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L932-L969】【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L1014-L1049】
- **Adapter Ingestion** – `ARVisorWearableAdapter` now unwraps spatial traces, preserves quaternion payloads, and forwards them with calibrated confidences so the registry can emit validated `spatial.*` channels.【F:src/ui/adaptive/sensors/adapters/ARVisorWearableAdapter.js†L17-L113】【F:src/ui/adaptive/sensors/adapters/ARVisorWearableAdapter.js†L147-L226】
- **Bridge Propagation** – The `SensoryInputBridge` fans out composite wearable channels (including `spatial.*`) to semantic listeners, allowing shaders and simulation layers to subscribe to quaternion-bearing poses as soon as they are ingested.【F:src/ui/adaptive/SensoryInputBridge.js†L294-L347】

## Synergy with the Quaternion Shader Pipeline
The rendering track’s quaternion-based shader system can consume the exact payloads we are emitting:

1. **Direct Uniform Updates** – Wearable spatial channels now surface validated quaternions for planes, anchors, and hit tests. The shader pipeline can bind these as per-frame uniforms to align lighting probes, decals, and particle systems without converting from Euler angles.
2. **Shared Normalisation Rules** – The registry’s `ensureQuaternion` guarantees unit-length inputs. The shader system can rely on this invariant and skip redundant renormalisation work on the GPU, reducing ALU overhead when thousands of quaternions are processed per frame.
3. **Consistent Handedness & Spaces** – By anchoring to the same pose definitions that OpenXR/WebXR uses, we avoid left/right handed mismatches between CPU logic and vertex shaders. Spatial channels annotate the reference space, enabling shaders to compose quaternions with the viewer pose exactly like the runtime.【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L737-L807】
4. **Temporal Blending** – Adapter confidences expose how trustworthy each quaternion sample is. The shader system can lerp orientations using these confidences (or discard low-confidence frames) to smooth reprojection and anchor stabilisation.

## Shader System Synchronization
- **Runtime bridge** – `ShaderQuaternionSynchronizer` listens to `spatial.anchors`, `spatial.hit-tests`, and `spatial.pose` updates from the `SensoryInputBridge`, normalises the quaternions, and maps them onto the shared `rot4d*` parameters for the faceted, quantum, and holographic systems while deriving motion energy for secondary effects.【F:src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js†L1-L207】
- **Quantum modulation** – The synchronizer feeds the quantum engine by lerping `rot4dXW/YW/ZW` and enriching `chaos`/`intensity` so volumetric lattices respond to headset motion through the existing `updateParameter` pipeline.【F:src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js†L208-L233】【F:systems/quantum/QuantumSystem.js†L248-L305】
- **Holographic hue steering** – Yaw-driven hue offsets and motion-weighted saturation deltas land on the holographic system’s parameter map, letting the shader palette pivot with spatial orientation without rewriting its UI bindings.【F:src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js†L208-L233】【F:systems/holographic/HolographicSystem.js†L299-L348】
- **Faceted dynamics** – Faceted visuals inherit the same quaternion-driven `rot4d*` envelopes, and motion energy subtly boosts `speed`, complementing the legacy slider interactions already wired through `updateParameter`.【F:src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js†L208-L233】【F:systems/faceted/FacetedSystem.js†L248-L305】
- **SDK access** – Adaptive SDK consumers can now spawn synchronizers through `createShaderQuaternionSynchronizer`, giving downstream apps a turnkey way to route OpenXR/WebXR quaternions into our shader stack without touching internal bridge wiring.【F:src/core/AdaptiveSDK.js†L8-L140】【F:types/adaptive-sdk.d.ts†L872-L912】
- **Coverage** – Dedicated Vitest coverage exercises anchor-triggered updates, motion-energy modulation, and confidence attenuation so shader teams can rely on deterministic quaternion behaviour before integrating the runtime feed.【F:tests/vitest/shader-quaternion-sync.test.js†L1-L102】

## Implementation Plan
1. **Shader Interface Contracts** – Expose helper utilities in the adaptive SDK that convert wearable spatial channels into GPU-ready uniform buffers (e.g., quaternion + translation + confidence).
2. **Cross-Team Validation** – Build diagnostic overlays that render plane normals and anchor axes directly from the shared quaternion data, proving that wearables, bridge, and shaders are interpreting the orientations identically.
3. **Runtime Optimisations** – Cache quaternion-to-matrix conversions inside the shader pipeline but invalidate when `SensoryInputBridge` emits updated spatial channels, keeping CPU↔GPU work balanced.
4. **Future Extensions** – Extend the same path for hand joint quaternions and controller grips once those adapters land, ensuring the shader system can drive IK solvers and retargeted avatars without bespoke conversions.

## When to Execute
- **Now** – Aligning ingestion and shader expectations is critical while spatial channels are still being built. The adapter updates in this turn mean we already emit the required data; the shader track can start wiring uniform bindings immediately.
- **Next 1–2 Turns** – Deliver SDK helpers and diagnostic overlays so developers can consume the quaternion streams confidently.
- **Ongoing** – As we add more OpenXR interaction profiles (controllers, hands), extend the same quaternion normalisation pipeline to maintain end-to-end consistency.
