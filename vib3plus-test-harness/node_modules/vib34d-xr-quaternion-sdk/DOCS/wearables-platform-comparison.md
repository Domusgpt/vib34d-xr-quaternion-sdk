# XR Wearables Platform Alignment Brief

## Executive Summary
- Khronos Group's **OpenXR** standard is the dominant cross-vendor runtime API for XR headsets, smart glasses, and controllers; it is used by Meta Quest, Microsoft HoloLens, HTC Vive, Varjo, and Pico shipping runtimes.
- OpenXR exposes a stable abstraction centered on session/space management, action-based input, and standardized extension discovery for sensors such as eye tracking, hand tracking, facial expression, and body tracking.
- Our current wearable stack uses bespoke composite schemas, confidence weighting, and licensing gates implemented in the `SensorSchemaRegistry`, `SensoryInputBridge`, and device-specific adapters. This offers flexibility but diverges from OpenXR's action/space semantics and standardized extension ecosystem.
- Aligning our telemetry and SDK layers to mirror OpenXR concepts (action sets, interaction profiles, XrSpace-based poses, extension identifiers) will reduce friction for partners shipping OpenXR runtimes, simplify certification, and improve interoperability with downstream engines.

## Industry Baseline: OpenXR
OpenXR is an open royalty-free standard managed by the Khronos Group. Its key architectural pillars include:

1. **Runtime / Application Contract** – Applications connect to a vendor-provided OpenXR runtime which exposes `xrCreateSession`, `xrBeginSession`, and `xrEndSession` for lifecycle control. Runtimes unify headset pose, composition layers, and time synchronization without vendor-specific SDKs.
2. **Action-Based Input** – Instead of polling raw device channels, OpenXR defines `XrActionSet` and `XrAction` objects bound to interaction profiles (e.g., `XR_INPUT_SOURCE_HEAD`, `XR_EXT_eye_gaze_interaction`). Actions expose types such as boolean, float, pose, and vibration. Applications query `xrSyncActions` to fetch state per frame.
3. **Spaces & Poses** – Device tracking is expressed via `XrSpace` objects. Headset, controller, hand, and face anchors are located with `xrLocateSpace`, returning poses with confidence data tied to a common time base.
4. **Extension Registry** – OpenXR publishes optional extensions for advanced sensors: `XR_EXT_eye_gaze_interaction` (eye tracking), `XR_FB_face_tracking` / `XR_HTC_body_tracking` (facial/body), `XR_ML_marker_understanding` (Vision Pro style). Vendors ship runtime manifests advertising supported extensions so applications can dynamically enable them.
5. **Event Pump & Frame Timing** – `xrPollEvent` exposes lifecycle and state notifications, while `xrWaitFrame`/`xrBeginFrame` coordinate rendering cadence, ensuring telemetry, rendering, and passthrough align to the runtime's predicted display time.

## Current Wearables Stack Snapshot
Our implementation currently provides:

- **Custom composite schemas per wearable**: `SensorSchemaRegistry` registers device-specific bundles (AR visor, neural band, biometric wrist) that normalize nested payloads, compute metadata, and clamp confidences per channel.【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L398-L492】【F:src/ui/adaptive/sensors/SensorSchemaRegistry.js†L504-L612】
- **Bridge-managed history & snapshots**: `SensoryInputBridge` recursively applies wearable composites, tracks bounded history, and exposes `getWearableSnapshot` and `listWearableDevices` utilities for downstream consumers.【F:src/ui/adaptive/SensoryInputBridge.js†L321-L568】
- **Adapter-driven ingestion**: Concrete adapters extend `BaseWearableDeviceAdapter` to enforce license checks, throttle telemetry, and feed normalized payloads into the bridge via the `WearableDeviceManager` facade.【F:src/ui/adaptive/sensors/adapters/BaseWearableDeviceAdapter.js†L99-L238】【F:src/ui/adaptive/sensors/WearableDeviceManager.js†L5-L158】

## Gap Analysis vs. OpenXR
| Area | OpenXR Approach | Current Implementation | Observations |
| --- | --- | --- | --- |
| Device Discovery | `xrEnumerateViewConfigurations`, `xrEnumeratePaths`, and runtime-advertised extensions identify sensors at runtime. | Device types are hard-coded in the registry with static schema IDs (`wearable.ar-visor`, `wearable.neural-band`, etc.). | Need a dynamic discovery mechanism or mapping layer to OpenXR interaction profiles and extension strings. |
| Input Model | Actions represent semantic intent (select, squeeze, gaze) bound to interaction profiles. | Channels deliver raw payloads (vectors, quaternions, biometrics) with per-channel confidences. | Consider layering an action abstraction on top of channels to map to OpenXR-compatible semantics. |
| Spatial Data | Poses delivered via `XrSpace` with time-aligned `XrPosef`. | Pose metadata optional per wearable; not tied to shared reference frames or predicted display time. | Introduce space identifiers, timestamp alignment, and orientation conventions matching `xrLocateSpace` outputs. |
| Extension Negotiation | Applications query `xrEnumerateInstanceExtensionProperties` to opt into features. | Licensing gates exist, but extension availability is implicit; no registry of capabilities. | Provide an extension capability manifest per adapter that mirrors OpenXR extension naming. |
| Event Timing | Frame loop synchronized via `xrWaitFrame` and `xrBeginFrame`. | Bridge timestamps rely on incoming payload timestamps without runtime coordination. | Add clock synchronization hooks or integrate runtime frame prediction data if available. |

## Recommendations
1. **Capability Manifests & Interaction Profiles** – Augment each adapter with a manifest that declares supported OpenXR interaction profiles and extension IDs. Use this to autogenerate discovery payloads and align schema identifiers with OpenXR naming.
2. **Action Layer Abstraction** – Build an action mapping service that converts normalized channel data (e.g., gaze vectors, intent confidences) into OpenXR-style action states. This will let downstream engines interface via familiar semantics.
3. **Space-Aware Metadata** – Extend wearable metadata to include named spaces (`local`, `stage`, `view`) and deliver poses with the same axes, units, and handedness as OpenXR's `XrPosef`. Capture predicted display time or frame ID alongside sensor timestamps.
4. **Extension Negotiation API** – Provide APIs similar to `xrEnumerateInstanceExtensionProperties` so clients can detect optional capabilities (eye tracking, biometrics) before subscribing, aligning with license gating.
5. **Compliance Testing** – Create automated compatibility tests that validate our normalized payloads against OpenXR conformance guidelines (pose conventions, action ranges), improving partner confidence.

## Next Steps
- Prototype a lightweight adapter that projects our AR visor schema into OpenXR-compatible action bindings (head pose -> `XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO`, gaze -> `XR_EXT_eye_gaze_interaction`).
- Draft partner documentation showing how to integrate our telemetry service with an OpenXR runtime, including manifest examples and suggested extension names.
- Evaluate leveraging existing OpenXR SDKs (e.g., Monado, OpenXR Loader) within our tooling to validate interoperability early in development.

