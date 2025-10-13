# Visualization Parameter Contract

The Vib3 shader systems now share a common parameter contract so quaternion-driven
pipelines can target the faceted, quantum, and holographic renderers with a single
update path.

## Interface Overview

| Method | Purpose |
| --- | --- |
| `updateParameter(name, value, context?)` | Apply a single parameter change. Implementations accept an optional context payload describing the source of the update. |
| `batchUpdate(updates, context?)` | Apply a set of parameter changes atomically. Implementations should prefer this path when available to minimize GPU uniform churn. |

The context payload is passed straight through from the quaternion synchronizer and includes:

- `confidence` – weighted confidence hint from XR pose data.
- `motionEnergy` – smoothed angular velocity derived from quaternion deltas.
- `timestamp` and `source` – timing and origin metadata for profiling.
- `euler`/`quaternion`/`uniforms` – the orientation math already prepared for shaders.
- `parameters` – per-parameter lerp metadata (`current`, `target`, and `alpha`).

## Producer Responsibilities

`ShaderQuaternionSynchronizer` gathers lerped parameter values, attaches the context
metadata, and prefers `batchUpdate` when systems expose it, falling back to
`updateParameter` when necessary.【F:src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js†L248-L358】

## Consumer Implementations

- **QuantumEngine** normalizes incoming updates, clamps via `ParameterManager`, and
  pushes a single object into every quantum visualizer so each GPU layer stays in
  sync.【F:src/quantum/QuantumEngine.js†L163-L193】【F:src/quantum/QuantumEngine.js†L268-L347】
- **RealHolographicSystem** records persistent overrides, calls into each layer’s
  `updateParameters` method when available, and gracefully falls back to legacy
  visualizers that only support direct property writes.【F:src/holograms/RealHolographicSystem.js†L151-L220】
- **Visualizer / QuantumVisualizer / HolographicVisualizer** now accept the optional
  `context` argument so downstream consumers can opt into richer telemetry without
  altering existing behavior.【F:src/core/Visualizer.js†L631-L633】【F:src/quantum/QuantumVisualizer.js†L928-L932】【F:src/holograms/HolographicVisualizer.js†L930-L958】

## Usage Pattern

```js
// Synchronizer side (already implemented)
const context = { confidence: 0.82, motionEnergy: 0.48, systemName: 'quantum' };
quantumSystem.batchUpdate({
  rot4dXY: 0.00,
  rot4dXZ: 0.00,
  rot4dYZ: 0.00,
  rot4dXW: -0.16,
  rot4dYW: 0.48,
  rot4dZW: 0.32,
  chaos: 0.40,
  intensity: 0.86
}, context);
```

```js
// Renderer side (QuantumEngine)
updateParameter(name, value, context) {
  this.batchUpdate({ [name]: value }, context);
}
```

The shared contract keeps quaternion-driven updates coherent, reduces duplicate
math, and exposes the rich context metadata that later telemetry and profiling
phases will consume.
