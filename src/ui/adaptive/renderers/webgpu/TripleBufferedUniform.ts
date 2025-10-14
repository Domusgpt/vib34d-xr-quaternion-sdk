/**
 * TripleBufferedUniform
 * ------------------------------------------------------------
 * Minimal helper for rotating uniform buffers at XR frame rates without
 * forcing the CPU to wait for GPU completion. The implementation mirrors the
 * recommended WebGPU ring-buffer strategy highlighted in the migration plan
 * so the WebXR pose ingestion path can keep feeding the renderer at 90-120Hz.
 */

export interface GPUQueueLike {
  writeBuffer(
    buffer: GPUBufferLike,
    bufferOffset: number,
    data: ArrayBufferView | ArrayBuffer,
    dataOffset?: number,
    size?: number
  ): void;
}

export interface GPUBufferLike {
  readonly size?: number;
  readonly label?: string;
  destroy?: () => void;
}

export interface GPUDeviceLike {
  readonly queue: GPUQueueLike;
  createBuffer(descriptor: GPUBufferDescriptorLike): GPUBufferLike;
}

export interface GPUBufferDescriptorLike {
  readonly size: number;
  readonly usage: number;
  readonly label?: string;
  readonly mappedAtCreation?: boolean;
}

export interface TripleBufferedUniformOptions {
  /** Optional override for the number of buffers (defaults to 3). */
  readonly bufferCount?: number;
  /** Label prefix applied to every created buffer for GPU debugging tools. */
  readonly label?: string;
  /**
   * GPU usage flags. By default we combine the WebGPU UNIFORM and COPY_DST
   * bits (0x10 | 0x8) so callers do not need the WebGPU type definitions.
   */
  readonly usage?: number;
}

const GPU_BUFFER_USAGE_UNIFORM = 0x40;
const GPU_BUFFER_USAGE_COPY_DST = 0x8;

/**
 * TripleBufferedUniform stores multiple GPUBuffer handles and rotates through
 * them as new frame data arrives. The write pointer always advances, while the
 * bind pointer lags behind by one frame to avoid hazards.
 */
export class TripleBufferedUniform {
  private readonly buffers: GPUBufferLike[];
  private currentIndex = 0;
  private readonly bufferCount: number;
  private readonly device: GPUDeviceLike;

  constructor(device: GPUDeviceLike, size: number, options: TripleBufferedUniformOptions = {}) {
    if (!device || typeof device.createBuffer !== 'function') {
      throw new Error('TripleBufferedUniform requires a WebGPU-like device');
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error('TripleBufferedUniform size must be a positive number');
    }

    const bufferCount = Math.max(2, Math.floor(options.bufferCount ?? 3));
    const usage = options.usage ?? (GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST);
    const labelPrefix = options.label ?? 'TripleBufferedUniform';

    this.device = device;
    this.bufferCount = bufferCount;
    this.buffers = Array.from({ length: bufferCount }, (_, index) =>
      device.createBuffer({ size, usage, label: `${labelPrefix}#${index}` })
    );
  }

  /** Returns the buffer index that will be written next. */
  get writeIndex(): number {
    return this.currentIndex;
  }

  /** Returns the buffer index that is safe to bind this frame. */
  get bindIndex(): number {
    return (this.currentIndex + this.bufferCount - 1) % this.bufferCount;
  }

  /** Returns the GPUBuffer handle that should be bound for draw/dispatch. */
  get bindBuffer(): GPUBufferLike {
    return this.buffers[this.bindIndex];
  }

  /** Returns the GPUBuffer handle that will be written to on the next update. */
  get writeBuffer(): GPUBufferLike {
    return this.buffers[this.writeIndex];
  }

  /** Rotates the write pointer and uploads new uniform data. */
  update(data: ArrayBufferView | ArrayBuffer, queue: GPUQueueLike = this.device.queue): void {
    if (!queue || typeof queue.writeBuffer !== 'function') {
      throw new Error('TripleBufferedUniform.update requires a GPU queue');
    }

    queue.writeBuffer(this.writeBuffer, 0, data);
    this.currentIndex = (this.currentIndex + 1) % this.bufferCount;
  }

  /**
   * Helper for bind group creation. Returns a minimal descriptor entry so the
   * caller can spread into an existing bind group configuration.
   */
  bindGroupEntry(binding = 0): { binding: number; resource: { buffer: GPUBufferLike } } {
    return {
      binding,
      resource: { buffer: this.bindBuffer }
    };
  }

  /** Explicitly destroy all underlying buffers. */
  dispose(): void {
    for (const buffer of this.buffers) {
      try {
        buffer.destroy?.();
      } catch (error) {
        // No-op; destruction failures are non-fatal in most runtimes.
      }
    }
  }
}

export default TripleBufferedUniform;
