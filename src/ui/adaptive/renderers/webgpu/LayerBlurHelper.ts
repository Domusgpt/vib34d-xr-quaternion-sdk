import { GPU_TEXTURE_USAGE_RENDER_ATTACHMENT, GPU_TEXTURE_USAGE_TEXTURE_BINDING, type GPUDeviceRaw, type GPUTextureRaw } from './GPUInterfaces.ts';
import type { LayerDescriptor } from './MultiLayerGlassComposer.ts';
import { createSeparableBlurPipeline, writeBlurUniforms } from './SeparableBlurPipeline.ts';

interface LayerBlurTextures {
  horizontal: GPUTextureRaw | null;
  vertical: GPUTextureRaw | null;
  horizontalView: unknown | null;
  verticalView: unknown | null;
  halfWidth: number;
  halfHeight: number;
  horizontalBindGroup: unknown | null;
  verticalBindGroup: unknown | null;
  lastSourceView: unknown | null;
}

export interface LayerBlurHelperOptions {
  readonly device: GPUDeviceRaw;
  readonly layers: LayerDescriptor[];
  readonly format: string;
  readonly sampler: unknown;
}

export class LayerBlurHelper {
  private readonly device: GPUDeviceRaw;
  private readonly layers: LayerDescriptor[];
  private readonly sampler: unknown;
  private readonly format: string;

  private blurResources: ReturnType<typeof createSeparableBlurPipeline> | null = null;
  private uniformBindGroup: unknown | null = null;
  private textures: LayerBlurTextures[] = [];
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(options: LayerBlurHelperOptions) {
    this.device = options.device;
    this.layers = options.layers;
    this.sampler = options.sampler;
    this.format = options.format;

    if (this.layers.some(layer => (layer.blurRadius ?? 0) > 0)) {
      this.blurResources = createSeparableBlurPipeline(this.device, this.format);
      this.uniformBindGroup = this.device.createBindGroup({
        layout: this.blurResources.uniformBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.blurResources.uniformBuffer }
          }
        ]
      });
    }
  }

  resize(width: number, height: number): void {
    if (!this.blurResources) {
      return;
    }

    if (width === this.lastWidth && height === this.lastHeight && this.textures.length > 0) {
      return;
    }

    this.disposeTextures();
    this.lastWidth = width;
    this.lastHeight = height;

    this.textures = this.layers.map(layer => {
      if ((layer.blurRadius ?? 0) <= 0) {
        return {
          horizontal: null,
          vertical: null,
          horizontalView: null,
          verticalView: null,
          halfWidth: 0,
          halfHeight: 0,
          horizontalBindGroup: null,
          verticalBindGroup: null,
          lastSourceView: null,
        };
      }

      const halfWidth = Math.max(1, Math.floor(width / 2));
      const halfHeight = Math.max(1, Math.floor(height / 2));
      const horizontal = this.device.createTexture({
        label: `${layer.name}-blur-h`,
        size: { width: halfWidth, height: halfHeight, depthOrArrayLayers: 1 },
        format: this.format,
        usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT | GPU_TEXTURE_USAGE_TEXTURE_BINDING,
      });
      const vertical = this.device.createTexture({
        label: `${layer.name}-blur-v`,
        size: { width: halfWidth, height: halfHeight, depthOrArrayLayers: 1 },
        format: this.format,
        usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT | GPU_TEXTURE_USAGE_TEXTURE_BINDING,
      });
      const horizontalView = horizontal.createView();
      const verticalView = vertical.createView();

      return {
        horizontal,
        vertical,
        horizontalView,
        verticalView,
        halfWidth,
        halfHeight,
        horizontalBindGroup: null,
        verticalBindGroup: this.device.createBindGroup({
          layout: this.blurResources.sourceBindGroupLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: horizontalView },
          ],
        }),
        lastSourceView: null,
      };
    });
  }

  encodeBlur(
    encoder: { beginRenderPass(descriptor: Record<string, unknown>): { setPipeline(pipeline: unknown): void; setBindGroup(index: number, group: unknown): void; draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void; end(): void; }; },
    layerIndex: number,
    sourceView: unknown,
    sourceWidth: number,
    sourceHeight: number
  ): unknown {
    if (!this.blurResources) {
      return sourceView;
    }

    const descriptor = this.textures[layerIndex];
    const radius = this.layers[layerIndex]?.blurRadius ?? 0;
    if (!descriptor || radius <= 0 || !descriptor.horizontalView || !descriptor.verticalView) {
      return sourceView;
    }

    const pipeline = this.blurResources.pipeline;

    writeBlurUniforms(this.device, this.blurResources.uniformBuffer, {
      direction: [1, 0],
      texelSize: [1 / Math.max(1, sourceWidth), 1 / Math.max(1, sourceHeight)],
      radius,
    });

    if (!descriptor.horizontalBindGroup || descriptor.lastSourceView !== sourceView) {
      descriptor.horizontalBindGroup = this.device.createBindGroup({
        layout: this.blurResources.sourceBindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: sourceView },
        ],
      });
      descriptor.lastSourceView = sourceView;
    }

    const horizontalPass = encoder.beginRenderPass({
      label: `Blur-H-${this.layers[layerIndex]?.name ?? layerIndex}`,
      colorAttachments: [
        {
          view: descriptor.horizontalView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    horizontalPass.setPipeline(pipeline);
    if (this.uniformBindGroup) {
      horizontalPass.setBindGroup(0, this.uniformBindGroup);
    }
    horizontalPass.setBindGroup(1, descriptor.horizontalBindGroup);
    horizontalPass.draw(3, 1, 0, 0);
    horizontalPass.end();

    writeBlurUniforms(this.device, this.blurResources.uniformBuffer, {
      direction: [0, 1],
      texelSize: [1 / Math.max(1, descriptor.halfWidth), 1 / Math.max(1, descriptor.halfHeight)],
      radius,
    });

    const verticalBindGroup = descriptor.verticalBindGroup ?? this.device.createBindGroup({
      layout: this.blurResources.sourceBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: descriptor.horizontalView },
      ],
    });
    descriptor.verticalBindGroup = verticalBindGroup;

    const verticalPass = encoder.beginRenderPass({
      label: `Blur-V-${this.layers[layerIndex]?.name ?? layerIndex}`,
      colorAttachments: [
        {
          view: descriptor.verticalView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    verticalPass.setPipeline(pipeline);
    if (this.uniformBindGroup) {
      verticalPass.setBindGroup(0, this.uniformBindGroup);
    }
    verticalPass.setBindGroup(1, verticalBindGroup);
    verticalPass.draw(3, 1, 0, 0);
    verticalPass.end();

    return descriptor.verticalView;
  }

  getCompositeView(layerIndex: number, fallback: unknown): unknown {
    const descriptor = this.textures[layerIndex];
    if (!descriptor || !descriptor.verticalView || (this.layers[layerIndex]?.blurRadius ?? 0) <= 0) {
      return fallback;
    }
    return descriptor.verticalView;
  }

  dispose(): void {
    this.disposeTextures();
    this.blurResources = null;
    this.uniformBindGroup = null;
  }

  private disposeTextures(): void {
    this.textures.forEach(entry => {
      entry?.horizontal?.destroy?.();
      entry?.vertical?.destroy?.();
      entry.horizontalBindGroup = null;
      entry.verticalBindGroup = null;
      entry.lastSourceView = null;
    });
    this.textures = [];
    this.lastWidth = 0;
    this.lastHeight = 0;
  }
}

export default LayerBlurHelper;
