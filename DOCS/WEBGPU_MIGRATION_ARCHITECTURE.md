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
- **Layout helpers** — `BufferLayout.ts` codifies std140/std430 alignment rules so CPU writers match WGSL expectations, providing typed utilities for writing/reading fields and exporting the canonical `GlassUniformLayout` shared across the bridge, harness, and tests.【F:src/ui/adaptive/renderers/webgpu/BufferLayout.ts†L1-L184】
- **Localization uniform** — `LocalizationBridge`, `QuaternionFabricRouter`, and `RotorFusionService` now populate a dedicated `localization` vec4 in the `GlassUniformLayout`, exposing stage/anchor confidence, drift, and latency to shaders. The `pnpm codegen:localization` script emits synchronized TypeScript/WGSL/C# bindings for these metrics.【F:src/ui/adaptive/localization/index.ts†L1-L3】【F:src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts†L17-L239】【F:tools/codegen/localization-quaternions.ts†L1-L112】

## 4. Module Scaffolding

To make the migration actionable, a lightweight composer class now orchestrates layer metadata, render target descriptors, and risk analysis hooks:

- `MultiLayerGlassComposer` accepts the device, layer descriptors, and render target configuration, then produces:
  - A list of intermediate texture descriptors to allocate during renderer startup.
  - A pass plan describing draw and blur passes, respecting per-layer blur radii.
  - Uniform buffer management via the shared triple-buffer ring helper.
- The composer exposes `summarizeRisks()` so integration tests can surface configuration issues such as oversized textures or incorrect formats before hitting hardware limits.【F:src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts†L1-L129】
- `WebXRQuaternionBridge` consumes `XRFrame` poses (or mocks in CI), derives rotor snapshots through the shared math core, and streams pose, rotor, audio, and timing data into the composer’s uniform ring so the renderer stays latency-aware without depending on React-specific hooks.【F:src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts†L1-L210】
- `GlassUniformController` coordinates localization snapshots, rotor fusion smoothing, and uniform uploads so WebXR runtimes and the preview harness share identical quaternion/audio/localization orchestration without duplicating ingestion logic.【F:src/ui/adaptive/renderers/webgpu/GlassUniformController.ts†L1-L279】
- `WebGPUPreviewHarness` powers the Vite developer sandbox, wiring the composer + bridge into a browser-based WebGPU renderer so designers can validate the five-layer pass plan, observe audio-reactive responses, and surface configuration risks before touching production surfaces.【F:src/dev/webgpuPreviewHarness.ts†L1-L420】
- `GlassPipelineFactory` produces shared bind group layouts, sampler state, and render pipelines so both preview and runtime harnesses can consume identical shader configuration without duplicating boilerplate.【F:src/ui/adaptive/renderers/webgpu/GlassPipelineFactory.ts†L1-L309】
- `GlassShaderLibrary` generates WGSL layer shaders for the hypercube/hypersphere/hypertetra lattice family, mirroring the legacy WebGL math so geometry + projection choices stay in sync across preview and immersive pipelines; `GlassPipelineFactory` now instantiates a render pipeline per layer so mixes of geometry/projection modules are supported simultaneously.【F:src/ui/adaptive/renderers/webgpu/GlassShaderLibrary.ts†L1-L366】【F:src/ui/adaptive/renderers/webgpu/GlassPipelineFactory.ts†L1-L312】
- `WebXRGlassSession` owns XR session lifecycle, XRGPUBinding integration, and per-view texture allocation so immersive runtimes reuse the same composer/controller flow validated in the preview harness.【F:src/ui/adaptive/renderers/webgpu/WebXRGlassSession.ts†L1-L329】
- `PolytopeInstanceBuffer` packages std430 storage management for instanced polytopes, mirroring the layout helpers to stream matrices, rotors, colors, and misc scalars into GPU storage buffers with a single `writeInstance()` call.【F:src/ui/adaptive/renderers/webgpu/PolytopeInstanceBuffer.ts†L1-L139】

## 5. Quaternion Rotor Compute Pipeline

The migration now includes a reusable compute helper that transforms XR quaternions into GPU-friendly matrices and 4D rotation scalars in a single dispatch:

- `QuaternionRotorCompute` wraps shader module creation, storage buffer allocation, and bind group wiring so renderers can queue batched quaternion processing without duplicating boilerplate.【F:src/ui/adaptive/renderers/webgpu/QuaternionRotorCompute.ts†L1-L236】
- The WGSL kernel normalizes each quaternion, emits a `mat4x4<f32>` plus XW/YW/ZW rotation angles, and mirrors the CPU math helpers to guarantee deterministic results across environments.【F:src/ui/adaptive/renderers/webgpu/QuaternionRotorCompute.ts†L39-L125】【F:src/core/quaternion/index.ts†L127-L160】
- A `cpuProject` fallback matches the GPU layout so WebGL builds, tests, or offline baking tools can reuse identical data structures while WebGPU support is unavailable.【F:src/ui/adaptive/renderers/webgpu/QuaternionRotorCompute.ts†L168-L198】

Usage example:

```ts
const compute = new QuaternionRotorCompute({ device, maxInstances: 512 });
compute.updateInput(quaternionBuffer);
compute.dispatch(commandEncoder, instanceCount);
```

For small batches or CI environments without WebGPU, call `QuaternionRotorCompute.cpuProject(quaternionArray)` to obtain the same 24-float per-instance layout consumed by the renderers.

## 6. Platform-Specific Considerations

- **Quest 3 (Adreno 740)** — Keep intermediate textures at or below 2048×2048 when possible to stay within tile memory. Favor half-resolution blur ping-pong targets for layers with strong diffusion.
- **Vision Pro (Apple GPU)** — Enable render bundle reuse aggressively; Vision Pro’s tile-based deferred renderer benefits from pre-validated command sequences. Consider quad-buffering uniforms if the app targets 120 Hz.
- **PCVR (Desktop GPUs)** — Leverage compute shaders for FFT-driven parameter blending and offload heavier 4D transformations to storage buffers when the instance count scales into the tens of thousands.

## 7. Implementation Roadmap Updates

1. **Phase 2 Kickoff**
   - ✅ Integrate the composer + triple buffer helpers into the Vite preview harness to replace the WebGL placeholder path (see `WebGPUPreviewHarness`).
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

## 8. Risks & Open Issues

- **Texture memory pressure** — The five intermediate `rgba16float` targets consume ~80 MB at 1920×1080. Implement resolution scaling heuristics to protect mobile headsets.
- **Tooling gaps** — Node 18 ships without WebGPU type definitions. We currently use local interfaces inside the helper modules; evaluate adopting `@webgpu/types` during Phase 2 to improve editor support.
- **Shader parity** — Maintaining WGSL and Unity HLSL versions of the glassmorphic shaders requires a shared source-of-truth. Extend the math core code generation pipeline to cover shader snippets.
- **Audio reactivity latency** — FFT uploads share the same ring buffer as pose data today; consider dedicating a storage buffer to avoid stalling uniform updates when FFT sizes grow.

The new helpers provide the scaffolding to implement this architecture while highlighting immediate follow-up work so we can track progress against the migration plan.
