# Visualization Parameter Contract

The quaternion pipeline now drives the faceted, quantum, and holographic
renderers through a shared contract that keeps runtime behaviour
consistent across runtimes and shader stacks. This document captures the
API surface and the expectations each visualization system must satisfy
when accepting XR-driven quaternion updates.

---

## Interface Overview

Every visualization consumer **must** expose the following methods:

```ts
interface VisualizationParameterConsumer {
  updateParameter(name: string, value: number, context?: VisualizationParameterContext): void;
  updateParameters?(params: Record<string, number>, context?: VisualizationParameterContext): void;
  batchUpdate?(params: Record<string, number>, context?: VisualizationParameterContext): void;
  getParameter?(name: string): number | undefined;
}

interface VisualizationParameterContext {
  confidence?: number;      // 0–1 confidence derived from XR tracking quality
  motionEnergy?: number;    // Smoothed angular velocity envelope
  euler?: { roll: number; pitch: number; yaw: number };
  source?: string;          // Optional source identifier (e.g. "spatial.pose")
}
```

* `updateParameter` remains the compatibility path for legacy systems.
* `batchUpdate` is the preferred entry point and should apply all
  mutations atomically, updating shader uniforms exactly once per frame.
* `getParameter` returns the latest committed value so upstream smoothers
  can honour the current state without accessing internals.

The helper utilities that enforce this contract live in
`src/ui/adaptive/renderers/contracts/VisualizationParameterContract.js`.

---

## Contract Responsibilities

1. **Atomicity** – `batchUpdate` should commit every supplied parameter
   before triggering renders. WebGL visualizers should update their
   uniform buffers only once per call.
2. **State Synchronisation** – Maintain authoritative parameter storage
   (`ParameterManager`, `customParams`, etc.) so UI panels, telemetry, and
   shader bindings stay in sync with XR-driven values.
3. **Fallback Safety** – If a consumer lacks `batchUpdate`, it must still
   tolerate `updateParameter` calls for incremental updates. The contract
   helpers automatically fall back in this order: `batchUpdate →
   updateParameters → updateParameter`.
4. **Observability** – Systems may use the optional `context` payload to
   log or react to confidence drops, motion energy spikes, or source
   transitions without duplicating heuristics in the synchronizer.

---

## Current Implementations

| System | Implementation Notes |
| --- | --- |
| **QuantumEngine** | Uses `ParameterManager` to validate and clamp inputs, pushes batched payloads to all WebGL visualizers in one pass. |
| **RealHolographicSystem** | Persists overrides in `customParams`, updates variant parameters per layer, and refreshes the on-screen parameter display after batch updates. |
| **Faceted/Polychora stack** | Inherits the shared helpers; existing per-parameter fallbacks remain valid until the new faceted engine is migrated. |

---

## Usage from the Synchronizer

`ShaderQuaternionSynchronizer` now prepares rotation and modulation
values, then submits them via `applyVisualizationUpdates`. The helper
prefers `batchUpdate` so all parameters (`rot4dXW`, `rot4dYW`, `rot4dZW`,
`speed`, `hue`, `chaos`, etc.) land in a single call, eliminating
inter-frame tearing that previously occurred when updates were applied
individually.

```js
const updates = new Map();
updates.set('rot4dXW', 0.42);
updates.set('rot4dYW', -0.17);
updates.set('speed', 1.2);

applyVisualizationUpdates('faceted', facetedSystem, updates, {
  confidence: 0.92,
  motionEnergy: 0.35,
  euler: { roll: 0.1, pitch: 0.2, yaw: 0.3 }
});
```

When building new visualization modules, import the helpers to retrieve
current values safely:

```js
import { getVisualizationParameter } from '../contracts/VisualizationParameterContract.js';

const currentChaos = getVisualizationParameter(quantumEngine, 'chaos');
```

---

Maintaining this contract ensures quaternion-driven behaviour remains
predictable across every renderer as the Vib3 architecture expands.
