import { describe, expect, it } from 'vitest';
import { PolytopeInstanceBuffer } from '../src/ui/adaptive/renderers/webgpu/PolytopeInstanceBuffer.ts';
import type { GPUBufferLike, GPUDeviceLike } from '../src/ui/adaptive/renderers/webgpu/TripleBufferedUniform.ts';

interface MockBuffer extends GPUBufferLike {
  readonly id: number;
}

interface MockQueue {
  readonly writes: Array<{ buffer: MockBuffer; data: ArrayBufferView | ArrayBuffer }>;
  writeBuffer: (buffer: MockBuffer, offset: number, data: ArrayBufferView | ArrayBuffer) => void;
}

interface MockDevice extends GPUDeviceLike {
  readonly queue: MockQueue;
  readonly created: MockBuffer[];
}

function createMockDevice(): MockDevice {
  const created: MockBuffer[] = [];
  const writes: Array<{ buffer: MockBuffer; data: ArrayBufferView | ArrayBuffer }> = [];
  const queue: MockQueue = {
    writes,
    writeBuffer: (buffer, _offset, data) => {
      writes.push({ buffer, data });
    },
  };

  return {
    queue,
    created,
    createBuffer: ({ size, label }) => {
      if (!Number.isFinite(size) || size <= 0) {
        throw new Error('Invalid buffer size');
      }
      const buffer: MockBuffer = {
        id: created.length,
        label,
        size,
        writes: [],
      };
      created.push(buffer);
      return buffer;
    },
  } as MockDevice;
}

describe('PolytopeInstanceBuffer', () => {
  it('writes instance data and reports counts', () => {
    const device = createMockDevice();
    const instances = new PolytopeInstanceBuffer({ device, maxInstances: 4 });

    const matrix = new Float32Array(16).map((_, i) => i + 1);
    const rotor = [0.1, 0.2, 0.3, 0.4];
    const color = [0.9, 0.8, 0.7, 1];

    instances.writeInstance(
      {
        modelMatrix: matrix,
        rotor,
        color,
        misc: { scale: 2, audioEnergy: 0.5, glitch: 0.1, id: 42 },
      },
      { index: 0 },
    );

    expect(instances.count).toBe(1);

    const readback = instances.readInstance(0);
    expect(Array.from(readback.modelMatrix)).toEqual(Array.from(matrix));
    readback.rotor.forEach((value, index) => {
      expect(value).toBeCloseTo(rotor[index], 6);
    });
    readback.color.forEach((value, index) => {
      expect(value).toBeCloseTo(color[index], 6);
    });
    const expectedMisc = [2, 0.5, 0.1, 42];
    readback.misc.forEach((value, index) => {
      expect(value).toBeCloseTo(expectedMisc[index], 6);
    });
  });

  it('uploads to the GPU queue and resets state', () => {
    const device = createMockDevice();
    const instances = new PolytopeInstanceBuffer({ device, maxInstances: 2 });

    instances.writeInstance(
      {
        modelMatrix: new Float32Array(16).fill(0),
        rotor: [0, 0, 0, 1],
        color: [1, 0, 0, 1],
      },
      { index: 1 },
    );

    expect(instances.count).toBe(2);

    instances.upload();
    expect(device.queue.writes).toHaveLength(1);

    instances.reset();
    expect(instances.count).toBe(0);
    expect(instances.readInstance(0).misc[0]).toBe(0);
  });
});
