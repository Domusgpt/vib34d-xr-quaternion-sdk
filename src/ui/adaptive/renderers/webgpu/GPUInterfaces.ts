import type { GPUBufferLike, GPUDeviceLike, GPUQueueLike } from './TripleBufferedUniform.ts';

export type { GPUBufferLike, GPUDeviceLike, GPUQueueLike } from './TripleBufferedUniform.ts';

export interface GPUDeviceRaw extends GPUDeviceLike {
  createSampler(descriptor: Record<string, unknown>): unknown;
  createTexture(descriptor: Record<string, unknown>): GPUTextureRaw;
  createBindGroupLayout(descriptor: Record<string, unknown>): unknown;
  createPipelineLayout(descriptor: Record<string, unknown>): unknown;
  createShaderModule(descriptor: Record<string, unknown>): unknown;
  createRenderPipeline(descriptor: Record<string, unknown>): unknown;
  createCommandEncoder(descriptor?: Record<string, unknown>): GPUCommandEncoderRaw;
  createBindGroup(descriptor: Record<string, unknown>): unknown;
}

export interface GPUTextureRaw {
  createView(descriptor?: Record<string, unknown>): unknown;
  destroy?: () => void;
}

export interface GPUCommandEncoderRaw {
  beginRenderPass(descriptor: Record<string, unknown>): GPURenderPassEncoderRaw;
  finish(): unknown;
}

export interface GPURenderPassEncoderRaw {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  end(): void;
  setViewport?(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth?: number,
    maxDepth?: number,
  ): void;
}

export const GPU_SHADER_STAGE_VERTEX = 0x1;
export const GPU_SHADER_STAGE_FRAGMENT = 0x2;
export const GPU_TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
export const GPU_TEXTURE_USAGE_TEXTURE_BINDING = 0x4;
export const GPU_BUFFER_USAGE_UNIFORM = 0x40;
export const GPU_BUFFER_USAGE_COPY_DST = 0x8;
