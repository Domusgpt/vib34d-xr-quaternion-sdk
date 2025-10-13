# WebGPU Migration Architecture for the Vib3 XR Glassmorphic Stack

This document operationalizes the proposed WebGPU migration plan for the five-layer glassmorphic renderer while keeping the quaternion fabric at the center of the pipeline. It translates the research summary into implementation primitives the team can adopt during Phase 2 of the development track.

## 1. Architectural Overview

- **Rendering model** — Adopt a multi-pass renderer where every glassmorphic layer renders into its own `rgba16float` intermediate texture. Each texture supports optional blur passes (horizontal + vertical) before the layer contributes to the final composite.
- **Command submission** — Use render bundles for repeated draw calls per layer so mobile GPUs avoid redundant validation work. Bundles should encapsulate the fullscreen quad draw plus layer-specific bind groups.
- **Quaternion fabric** — Keep quaternions normalized on the CPU path (shared math core) and feed them directly into WGSL shaders. Only derive Euler angles for the 4D lattice mappings that power the holographic layer transitions.
- **Hybrid processing** — Perform batch quaternion-to-matrix conversions inside a compute shader when more than ~256 instances are queued (e.g., particle emitters). Lightweight rotations stay in the vertex shader using direct quaternion-vector rotation.

## 2. Multi-Pass Render Flow

1. **Prepare layer targets** — Allocate five intermediate textures sized to the XR view. Use `GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING` so each texture can be both rendered to and sampled from.
2. **Per-layer passes** — For each layer (back → front):
   - Clear the target to transparent black.
   - Bind the layer pipeline and parameter bind groups (including quaternion uniforms).
   - Draw the fullscreen quad.
   - If blur is requested, dispatch paired horizontal/vertical passes using half-resolution ping-pong textures.
3. **Composite pass** — Bind the swapchain (or XR projection layer view) and sample every intermediate texture with premultiplied alpha blending enabled (`srcFactor: one`, `dstFactor: one-minus-src-alpha`).
4. **Late latching** — Fetch the most recent XR pose immediately before command submission and update the uniform ring buffer to minimize pose-to-photon latency.

## 3. Quaternion-Driven Uniforms

- **Uniform layout** — Pack pose data, 4D rotation angles (XW, YW, ZW), smoothing parameters, audio FFT bins, and per-layer modulation scalars into a <1 KB struct. This comfortably fits inside the 64 KB WebGPU uniform limit.
- **Triple buffering** — Use a ring buffer of three uniform buffers to avoid GPU/CPU contention. The new `TripleBufferedUniform` helper encapsulates this rotation logic so renderers can call `updateUniforms()` each frame without worrying about hazards.【F:src/ui/adaptive/renderers/webgpu/TripleBufferedUniform.ts†L1-L121】
- **Bind groups** — Expose the safe-to-bind buffer via `getUniformBindGroupEntry()` and integrate it into each layer’s pipeline layout. Keep previous-frame quaternions in the struct to enable shader-side smoothing mixes.

## 4. Module Scaffolding

To make the migration actionable, a lightweight composer class now orchestrates layer metadata, render target descriptors, and risk analysis hooks:

- `MultiLayerGlassComposer` accepts the device, layer descriptors, and render target configuration, then produces:
  - A list of intermediate texture descriptors to allocate during renderer startup.
  - A pass plan describing draw and blur passes, respecting per-layer blur radii.
  - Uniform buffer management via the shared triple-buffer ring helper.
- The composer exposes `summarizeRisks()` so integration tests can surface configuration issues such as oversized textures or incorrect formats before hitting hardware limits.【F:src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts†L1-L129】

## 5. Platform-Specific Considerations

- **Quest 3 (Adreno 740)** — Keep intermediate textures at or below 2048×2048 when possible to stay within tile memory. Favor half-resolution blur ping-pong targets for layers with strong diffusion.
- **Vision Pro (Apple GPU)** — Enable render bundle reuse aggressively; Vision Pro’s tile-based deferred renderer benefits from pre-validated command sequences. Consider quad-buffering uniforms if the app targets 120 Hz.
- **PCVR (Desktop GPUs)** — Leverage compute shaders for FFT-driven parameter blending and offload heavier 4D transformations to storage buffers when the instance count scales into the tens of thousands.

## 6. Implementation Roadmap Updates

1. **Phase 2 Kickoff**
   - Integrate the composer + triple buffer helpers into the Vite preview harness to replace the current WebGL placeholder path. *(Completed — the dev preview now mounts the multi-pass WebGPU composer alongside the quaternion controls.)*
   - Port the quaternion preview Storybook stories to target the WebGPU renderer, ensuring shader math parity with the existing synchronizer tests.
2. **Shader Migration**
   - Convert GLSL shaders to WGSL, paying attention to sampler/texture binding separation and explicit `vecN<f32>` annotations.
   - Implement the separable Gaussian blur WGSL modules with configurable radius (per layer) and half-resolution sampling support.
3. **XR Binding**
   - Request an XR-compatible adapter before session creation and wire up `XRGPUBinding` to fetch projection layer textures per frame.
   - Validate pose smoothing in-shader by mixing current/previous quaternions using the supplied smoothing factor.
4. **Performance Validation**
   - Capture GPU timing queries for the blur passes and composite pass to ensure 90 FPS budgets on Quest 3.
   - Build Vitest-driven smoke tests that instantiate the composer with mock devices to confirm buffer rotations and pass planning remain deterministic.

## 7. Risks & Open Issues

- **Texture memory pressure** — The five intermediate `rgba16float` targets consume ~80 MB at 1920×1080. Implement resolution scaling heuristics to protect mobile headsets.
- **Tooling gaps** — Node 18 ships without WebGPU type definitions. We currently use local interfaces inside the helper modules; evaluate adopting `@webgpu/types` during Phase 2 to improve editor support.
- **Shader parity** — Maintaining WGSL and Unity HLSL versions of the glassmorphic shaders requires a shared source-of-truth. Extend the math core code generation pipeline to cover shader snippets.
- **Audio reactivity latency** — FFT uploads share the same ring buffer as pose data today; consider dedicating a storage buffer to avoid stalling uniform updates when FFT sizes grow.

The new helpers provide the scaffolding to implement this architecture while highlighting immediate follow-up work so we can track progress against the migration plan.
