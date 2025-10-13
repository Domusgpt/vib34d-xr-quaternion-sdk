# XR Pose Schema Normalization Guide

This guide explains how the Vib3 quaternion pipeline now standardizes pose payloads coming from WebXR, OpenXR, and custom wearable adapters. The goal is to ensure every subsystem receives the same `{ position, orientation }` structure with optional motion metadata while the quaternion math stays centralized in `QuaternionFieldService`.

---

## 1. Normalizer Overview

| Module | Purpose |
| --- | --- |
| `src/ui/adaptive/sensors/xr/XRPoseNormalizer.js` | Converts heterogeneous XR pose objects (WebXR `XRRigidTransform`, OpenXR structs, custom arrays) into the registry-friendly format and derives tracking confidence hints. |
| `SensorSchemaRegistry.register('spatial.pose', …)` | Invokes the normalizer, clamps numeric ranges, and publishes a consistent payload to the `SensoryInputBridge`. |
| `SensoryInputBridge.computeSpatialPoseConfidence()` | Blends adapter confidence with the hint emitted by the normalizer before downstream systems consume the event. |

The normalizer accepts:
- WebXR `XRPose`, `XRView`, `XRJointPose`, or raw `XRRigidTransform` objects.
- Arrays/typed arrays shaped like `[x, y, z, w]` or `[x, y, z]` for quaternions/vectors.
- Custom wearable payloads that expose `{ position, orientation }`.

---

## 2. Normalized Payload Shape

All `spatial.pose` events now emit the following structure:

```json
{
  "position": { "x": 0.0, "y": 0.0, "z": 0.0 },
  "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 },
  "linearVelocity": { "x": 0.0, "y": 0.0, "z": 0.0 } | null,
  "angularVelocity": { "x": 0.0, "y": 0.0, "z": 0.0 } | null,
  "referenceSpaceType": "local" | "viewer" | …,
  "referenceSpaceId": "uuid" | null,
  "emulatedPosition": true | false | null,
  "trackingState": "tracked" | "emulated" | "paused" | "lost" | "unknown",
  "radius": number | null,
  "confidence": 0.0 – 1.0 (hint derived from tracking status)
}
```

Key points:
- Orientation quaternions are normalized via `QuaternionFieldService.normalizeQuaternion` for numerical stability.
- `linearVelocity`/`angularVelocity` are only present when the platform supplies them; otherwise the properties are `null` for easier downstream checks.
- `confidence` is **not** the final event confidence—`SensoryInputBridge` will take the lesser of the adapter-provided confidence and this hint.

---

## 3. Confidence Derivation Rules

The `XRPoseNormalizer` determines a hint when explicit confidence values are absent:

1. Start at `1.0`.
2. Multiply by `0.65` if the pose reports `emulatedPosition === true`.
3. Multiply by:
   - `0.7` when `trackingState === 'emulated'`
   - `0.5` when `trackingState === 'paused'` or `'lost'`
4. Clamp to `[0, 1]`.

If the payload contains an explicit `confidence` or `trackingConfidence` number, that value is used instead and clamped.

---

## 4. Adapter Integration Checklist

1. **Return raw platform objects** – The normalizer handles DOM points, typed arrays, and plain objects. Avoid pre-normalizing unless necessary.
2. **Surface reference spaces** – Pass through `space`/`referenceSpace` objects so downstream consumers can align coordinate systems.
3. **Forward emulation flags** – Preserve `emulatedPosition` so shader smoothing can react to fallback tracking.
4. **Attach per-sample confidence when available** – If a platform emits quantitative confidence, set `sample.confidence` so the bridge can gate events before normalization.

---

## 5. Downstream Usage

- `ShaderQuaternionSynchronizer` now receives richer pose payloads, including velocity vectors and tracking metadata, enabling motion-adaptive parameter curves.
- Gesture and haptics layers can monitor `trackingState` to adjust thresholds dynamically (e.g., suppress aggressive feedback when tracking is paused).
- Future compute pipelines can consume `linearVelocity`/`angularVelocity` directly from the normalized payload without per-platform conditionals.

Keep this guide updated as additional XR runtimes or wearable formats are onboarded.
