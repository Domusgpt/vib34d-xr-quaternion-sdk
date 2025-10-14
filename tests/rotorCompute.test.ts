import { describe, expect, it } from 'vitest';
import {
  QuaternionRotorCompute,
  type GPUCommandEncoderLike,
  type GPUComputeDeviceLike,
  type GPUComputePassEncoderLike,
  type GPUBindGroupLike,
  type GPUComputePipelineLike,
  type GPUShaderModuleLike
} from '../src/ui/adaptive/renderers/webgpu/QuaternionRotorCompute.ts';
import {
  fromAxisAngle,
  quaternionToEuler,
  quaternionToMatrix4,
  quaternionTo4DRotationAngles
} from '../src/core/quaternion/index.ts';

type WriteCall = [MockBuffer, number, ArrayBufferView | ArrayBuffer];

interface MockBuffer {
  readonly label: string;
  writes: WriteCall[];
}

interface MockPipeline extends GPUComputePipelineLike {
  readonly layout: unknown;
}

interface MockBindGroup extends GPUBindGroupLike {
  readonly entries: Array<{ binding: number }>;
}

interface MockComputePass extends GPUComputePassEncoderLike {
  readonly record: {
    label?: string;
    pipeline?: GPUComputePipelineLike;
    bindGroups: Array<GPUBindGroupLike | undefined>;
    dispatches: Array<[number, number, number]>;
  };
}

function createMockDevice(): GPUComputeDeviceLike {
  const buffers: MockBuffer[] = [];
  const shaderModules: GPUShaderModuleLike[] = [];
  const pipelines: MockPipeline[] = [];
  const bindGroups: MockBindGroup[] = [];

  const queue = {
    writeBuffer: (...args: WriteCall) => {
      const [buffer] = args;
      buffer.writes.push(args);
    }
  };

  return {
    queue,
    createBuffer: ({ label }) => {
      const buffer: MockBuffer = {
        label: label ?? `buffer-${buffers.length}`,
        writes: []
      };
      buffers.push(buffer);
      return buffer;
    },
    createShaderModule: descriptor => {
      const module = { label: descriptor.label } satisfies GPUShaderModuleLike;
      shaderModules.push(module);
      if (!descriptor.code.includes('quat_to_matrix')) {
        throw new Error('WGSL source missing expected function');
      }
      return module;
    },
    createComputePipeline: descriptor => {
      const pipeline: MockPipeline = {
        label: descriptor.label,
        layout: descriptor.layout,
        getBindGroupLayout: () => ({ label: 'mock-layout' })
      };
      pipelines.push(pipeline);
      return pipeline;
    },
    createBindGroup: descriptor => {
      const group: MockBindGroup = {
        label: descriptor.label,
        entries: descriptor.entries.map(entry => ({ binding: entry.binding }))
      };
      bindGroups.push(group);
      return group;
    }
  } as GPUComputeDeviceLike;
}

function createMockEncoder() {
  const passes: Array<MockComputePass['record']> = [];
  const encoder: GPUCommandEncoderLike & { passes: typeof passes } = {
    passes,
    beginComputePass: descriptor => {
      const record: MockComputePass['record'] = {
        label: descriptor?.label,
        bindGroups: [],
        dispatches: []
      };
      const pass: GPUComputePassEncoderLike = {
        setPipeline: pipeline => {
          record.pipeline = pipeline;
        },
        setBindGroup: (index, bindGroup) => {
          record.bindGroups[index] = bindGroup;
        },
        dispatchWorkgroups: (x, y = 1, z = 1) => {
          record.dispatches.push([x, y, z]);
        },
        end: () => {
          passes.push(record);
        }
      };
      return pass;
    }
  };
  return encoder;
}

describe('QuaternionRotorCompute', () => {
  it('configures compute pipeline and dispatches workgroups', () => {
    const device = createMockDevice();
    const compute = new QuaternionRotorCompute({ device, maxInstances: 128, workgroupSize: 32, label: 'Rotor' });

    const encoder = createMockEncoder();
    const sampleCount = 96;
    const data = new Float32Array(sampleCount * 4);
    compute.process(encoder, data, sampleCount);

    expect(encoder.passes).toHaveLength(1);
    const pass = encoder.passes[0];
    expect(pass.label).toBe('Rotor-pass');
    expect(pass.pipeline).toBe(compute.pipeline);
    expect(pass.bindGroups[0]).toBe(compute.bindGroup);
    expect(pass.dispatches[0][0]).toBe(Math.ceil(sampleCount / 32));

    const inputBuffer = compute.getInputBuffer() as MockBuffer;
    expect(inputBuffer.writes).toHaveLength(1);
  });

  it('throws when dispatching beyond configured capacity', () => {
    const device = createMockDevice();
    const compute = new QuaternionRotorCompute({ device, maxInstances: 16 });
    const encoder = createMockEncoder();
    expect(() => compute.dispatch(encoder, 32)).toThrow(/exceeds the configured capacity/);
  });

  it('provides CPU fallback that matches quaternion math helpers', () => {
    const halfPi = Math.PI * 0.5;
    const qx = fromAxisAngle([1, 0, 0], halfPi);
    const qy = fromAxisAngle([0, 1, 0], halfPi);
    const cpuData = QuaternionRotorCompute.cpuProject(new Float32Array([...qx, ...qy]));

    expect(cpuData).toHaveLength(24 * 2);

    const expectedMatrixX = quaternionToMatrix4(qx);
    expectedMatrixX.forEach((value, index) => {
      expect(cpuData[index]).toBeCloseTo(value, 4);
    });

    const expectedRotorX = quaternionTo4DRotationAngles(qx);
    expect(cpuData[16]).toBeCloseTo(expectedRotorX[0], 4);
    expect(cpuData[17]).toBeCloseTo(expectedRotorX[1], 4);
    expect(cpuData[18]).toBeCloseTo(expectedRotorX[2], 4);

    const expectedEulerX = quaternionToEuler(qx);
    expect(cpuData[20]).toBeCloseTo(expectedEulerX[0], 4);
    expect(cpuData[21]).toBeCloseTo(expectedEulerX[1], 4);
    expect(cpuData[22]).toBeCloseTo(expectedEulerX[2], 4);

    const offset = 24;
    const expectedMatrixY = quaternionToMatrix4(qy);
    expectedMatrixY.forEach((value, index) => {
      expect(cpuData[offset + index]).toBeCloseTo(value, 4);
    });

    const expectedRotorY = quaternionTo4DRotationAngles(qy);
    expect(cpuData[offset + 16]).toBeCloseTo(expectedRotorY[0], 4);
    expect(cpuData[offset + 17]).toBeCloseTo(expectedRotorY[1], 4);
    expect(cpuData[offset + 18]).toBeCloseTo(expectedRotorY[2], 4);
  });
});
