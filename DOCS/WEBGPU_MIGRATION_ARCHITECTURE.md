# WebGPU Migration Architecture for Multi-Layer XR Shader Systems

## Executive Summary

The Vib3 glassmorphic renderer is migrating from WebGL to WebGPU to unlock sustained 90+ FPS performance on Quest-class hardware while scaling gracefully to visionOS and PCVR. The migration relies on WebGPU's explicit control over GPU resources, enabling multi-pass pipelines, triple-buffered uniforms, and hybrid CPU/compute shader quaternion processing. This document captures the target architecture, performance rationale, and integration checkpoints so Phase 2 of the development track can proceed without ambiguity.

Key outcomes:

- Adopt a five-layer multi-pass pipeline with rgba16float intermediate textures to preserve HDR blur quality and premultiplied alpha compositing.
- Centralize quaternion normalization on the CPU while delegating high-volume 4D rotor conversions to compute shaders for predictable latency.
- Implement triple-buffered uniform updates (ring buffer strategy) to eliminate GPU/CPU contention at 90–120 Hz tracking rates.
- Align WebXR/WebGPU integration flow with XRGPUBinding best practices and XR-compatible adapter negotiation.

## Rendering Pipeline Overview

### Why multi-pass beats MRT for glassmorphism

Blurred glass layers must sample previously rendered content, so Multiple Render Targets (MRT) cannot deliver the necessary feedback loop. WebGPU's render passes and render bundles provide an efficient alternative: each layer renders into its own rgba16float texture, downstream passes sample prior layers, and the final composite resolves to the canvas using the platform-preferred format (`navigator.gpu.getPreferredCanvasFormat()`).

```
Layer 0 → blur passes → Layer 1 → … → Layer 4 → composite → canvas
```

- **Texture format**: rgba16float balances precision against bandwidth—preventing banding while consuming half the storage of rgba32float.
- **Blur strategy**: separable Gaussian blur with optional 0.5× resolution ping-pong textures reduces samples per layer from 121 to 22 and keeps blur cost under 0.6 ms on Quest 3.
- **Blend state**: premultiplied alpha with `srcFactor: 'one'` / `dstFactor: 'one-minus-src-alpha'` avoids dark halos around overlapping layers.

### Render pass sequencing sketch

```ts
const layerTextures = Array.from({ length: 5 }, (_, i) =>
    device.createTexture({
        size: [width, height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    })
);

for (let index = 0; index < layerTextures.length; index++) {
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: layerTextures[index].createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }]
    });

    pass.setPipeline(layerPipelines[index]);

    if (index > 0) {
        pass.setBindGroup(0, bindGroups[index]); // previous layers for blur/composite
    }

    pass.draw(6);
    pass.end();
}
```

The final pass composites into the XR swapchain texture retrieved via `XRGPUBinding.getViewSubImage`. Render bundles can cache repeated draw command sequences to cut CPU validation overhead by up to 70% on mobile GPUs.

## Quaternion Processing Strategy

- **CPU responsibilities**: normalize XRFrame quaternions, extract Euler angles only for 4D lattice mappings, and pack pose data into ring-buffered uniform blocks.
- **GPU responsibilities**: compute shader converts quaternion batches into rotor matrices for high-cardinality geometry updates; vertex shaders rotate vectors directly via quaternion math when complexity is low.
- **WGSL helpers**: maintain shared functions for `quatRotate`, `quatToMatrix`, and 4D plane rotations (XW, YW, ZW). Shader modules are generated from the shared math core to prevent drift between JS, WGSL, C#, and Swift consumers.

Example WGSL rotation helper:

```wgsl
fn quatRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
```

## Uniform Buffer Management

### Triple-buffered ring strategy

A `TripleBufferedUniform` helper maintains three uniform buffers. The CPU writes to the current buffer each frame via `queue.writeBuffer`, advances the index, and bind groups target the buffer written two frames prior. This eliminates stalls when the GPU is still consuming frame N while the CPU prepares N+1.

```ts
class TripleBufferedUniform {
    constructor(device, size) {
        this.buffers = Array.from({ length: 3 }, () =>
            device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
        );
        this.index = 0;
    }

    update(device, data) {
        device.queue.writeBuffer(this.buffers[this.index], 0, data);
        this.index = (this.index + 1) % this.buffers.length;
    }

    currentBindGroup(device, layout) {
        const safe = (this.index + 1) % this.buffers.length;
        return device.createBindGroup({
            layout,
            entries: [{ binding: 0, resource: { buffer: this.buffers[safe] } }]
        });
    }
}
```

- Increase to quad-buffering for 120 Hz headsets if telemetry reveals occasional contention.
- Keep uniform payload under the 64 KB limit: two view-projection matrices, pose quaternion, 4D rotation floats, and audio FFT data (~1 KB total).

### Audio uniform updates

Audio FFT data should be normalized to float32 before uploading via a dedicated uniform buffer. This separation avoids stalling pose updates during heavy audio reactivity sequences.

## WebXR Integration Checklist

1. Request an XR-compatible GPU adapter before creating the XR session:
   ```ts
   const adapter = await navigator.gpu.requestAdapter({ xrCompatible: true });
   const device = await adapter.requestDevice();
   ```
2. Establish `XRGPUBinding` and create projection layers per eye with preferred color/depth formats.
3. Within `onXRFrame`, obtain per-view `subImage` textures, configure render passes with per-eye viewports, and submit command buffers each frame.
4. Respect WebGPU's [0, 1] depth range—use the projection matrices supplied by the XR runtime without manual adjustments.

## Platform-Specific Considerations

### Meta Quest 3

- Tile-based deferred rendering benefits from minimizing render pass transitions; batch layer passes via render bundles.
- Downsample blur passes to 0.5× resolution to cut bandwidth by ~4× without perceptible quality loss.
- Target 90 FPS with pose-to-photon latency reduced by 30–40% compared to the legacy WebGL path thanks to explicit buffer control.

### Apple Vision Pro

- Emphasize HDR compositing fidelity; rgba16float textures map well to visionOS color pipelines.
- PolySpatial requires single-pass stereo; reuse quaternion uniform buffers but ensure late-latched updates align with RealityKit's timeline.

### PCVR / Desktop

- Enable optional quad-buffering for 120 Hz displays.
- Allow toggling between render bundle caching and direct passes for debugging instrumentation (RenderDoc captures).

## Integration Milestones

| Milestone | Deliverable | Target Sprint |
| --- | --- | --- |
| Pipeline scaffolding | Layer texture allocation, render pass orchestration, premultiplied alpha compositing | Phase 2 — Week 3 |
| Quaternion compute path | WGSL compute module, triple-buffered uniform helpers, integration tests | Phase 2 — Week 4 |
| WebXR bridge | XRGPUBinding wiring, per-eye command submission, latency telemetry hooks | Phase 2 — Week 5 |
| Blur + audio reactivity tuning | Separable blur ping-pong, audio FFT uniform streaming, QA on Quest 3 (90 FPS) | Phase 2 — Week 6 |

## Open Issues & Risks

- **WGSL conversion tooling**: need deterministic GLSL → WGSL transforms for legacy shader snippets; evaluate `naga` or custom codegen.
- **Telemetry coverage**: ensure latency tracking captures CPU write time, GPU submission, and compositor presentation for accurate baseline comparisons.
- **Resource pressure**: rgba16float layers consume ~80 MB at 1080p; confirm acceptable for Quest 3 memory budget or introduce dynamic resolution scaling.
- **Team enablement**: document shader debugging workflow (RenderDoc, Chrome WebGPU capture) and provide sample captures.

## Next Steps

1. Wire the new architecture into the Phase 2 backlog in `ENVIRONMENT_SETUP_AND_DEV_TRACK.md` and associated Jira/Linear tickets.
2. Prototype the triple-buffer helper and WebXR render pass scaffolding inside the Vite preview harness to validate end-to-end data flow.
3. Report blockers (e.g., adapter negotiation issues, texture allocation limits) during stand-ups; escalate if Quest Browser flag requirements change.

