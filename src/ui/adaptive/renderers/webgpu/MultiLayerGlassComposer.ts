/**
 * MultiLayerGlassComposer
 * ------------------------------------------------------------
 * Declarative scaffolding for the five-layer glassmorphic renderer described in
 * the WebGPU migration architecture. This module does not perform rendering on
 * its own; instead it manages pipeline descriptors, render pass definitions, and
 * bind group wiring so higher-level systems can integrate the quaternion-driven
 * math core and shader programs without rewriting boilerplate.
 */

import { TripleBufferedUniform, type GPUDeviceLike, type GPUBufferLike } from './TripleBufferedUniform.ts';

export interface LayerDescriptor {
  /** Human readable layer name used for debugging and profiling. */
  readonly name: string;
  /** WGSL pipeline label used when creating GPU pipelines externally. */
  readonly pipelineLabel: string;
  /** Optional blur radius in texels; 0 disables the blur pass. */
  readonly blurRadius?: number;
}

export interface RenderTargetDescriptor {
  readonly width: number;
  readonly height: number;
  readonly format?: string;
}

export interface MultiLayerGlassComposerOptions {
  readonly device: GPUDeviceLike;
  readonly layers: LayerDescriptor[];
  readonly target: RenderTargetDescriptor;
  readonly uniformSize: number;
  readonly bufferCount?: number;
}

export interface PassPlan {
  readonly label: string;
  readonly colorAttachmentLabel: string;
  readonly blur?: {
    readonly horizontalTexture: string;
    readonly verticalTexture: string;
    readonly radius: number;
  };
  readonly layerIndex: number;
}

export class MultiLayerGlassComposer {
  readonly layers: LayerDescriptor[];
  readonly target: RenderTargetDescriptor;
  readonly uniformRing: TripleBufferedUniform;
  readonly passPlan: PassPlan[];

  constructor(options: MultiLayerGlassComposerOptions) {
    if (!options?.device) {
      throw new Error('MultiLayerGlassComposer requires a WebGPU device');
    }
    if (!Array.isArray(options.layers) || options.layers.length === 0) {
      throw new Error('MultiLayerGlassComposer requires at least one layer');
    }
    if (!Number.isFinite(options.uniformSize) || options.uniformSize <= 0) {
      throw new Error('MultiLayerGlassComposer requires a positive uniform size');
    }

    this.layers = options.layers;
    this.target = options.target;
    this.uniformRing = new TripleBufferedUniform(options.device, options.uniformSize, {
      bufferCount: options.bufferCount ?? 3,
      label: 'GlassGlobals'
    });
    this.passPlan = this.buildPassPlan();
  }

  /** Returns the underlying GPU buffers for each layer render target. */
  buildLayerTextureDescriptors(): { name: string; usage: number; format: string }[] {
    const format = this.target.format ?? 'rgba16float';
    const usage = 0x04 | 0x10; // TEXTURE_BINDING | RENDER_ATTACHMENT
    return this.layers.map(layer => ({
      name: `${layer.name}-target`,
      usage,
      format
    }));
  }

  /** Plans render and blur passes in back-to-front order. */
  private buildPassPlan(): PassPlan[] {
    const plan: PassPlan[] = [];
    this.layers.forEach((layer, index) => {
      const pass: PassPlan = {
        label: `Render-${layer.name}`,
        colorAttachmentLabel: `${layer.name}-target`,
        layerIndex: index
      };

      if ((layer.blurRadius ?? 0) > 0) {
        pass.blur = {
          horizontalTexture: `${layer.name}-blur-h`,
          verticalTexture: `${layer.name}-blur-v`,
          radius: layer.blurRadius ?? 0
        };
      }

      plan.push(pass);
    });
    return plan;
  }

  /**
   * Uploads global uniform data (poses, 4D rotation scalars, audio FFT, etc.).
   * The TripleBufferedUniform keeps hazard-free buffers ready for binding.
   */
  updateUniforms(data: ArrayBufferView | ArrayBuffer): void {
    this.uniformRing.update(data);
  }

  /** Convenience wrapper for bind group entries referencing the global UBO. */
  getUniformBindGroupEntry(binding = 0): { binding: number; resource: { buffer: GPUBufferLike } } {
    return this.uniformRing.bindGroupEntry(binding);
  }

  /** Returns a lightweight summary of outstanding tasks or risks. */
  summarizeRisks(): string[] {
    const risks: string[] = [];
    const maxTextureSize = Math.max(this.target.width, this.target.height);
    if (maxTextureSize > 4096) {
      risks.push('Intermediate rgba16float textures above 4k may exceed Quest 3 tile memory budgets.');
    }
    if (this.layers.length > 5) {
      risks.push('More than five layers can introduce bandwidth contention on mobile GPUs.');
    }
    if ((this.target.format ?? 'rgba16float') !== 'rgba16float') {
      risks.push('Non-HDR intermediate formats risk banding during blur accumulation.');
    }
    return risks;
  }
}

export default MultiLayerGlassComposer;
