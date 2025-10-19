import type {
  GPUCommandEncoderLike,
  GPUComputeDeviceLike,
  GPUComputePassEncoderLike,
  GPUBindGroupLike,
  GPUComputePipelineLike,
  GPUShaderModuleLike
} from '../../src/ui/adaptive/renderers/webgpu/QuaternionRotorCompute.ts';

export type WriteCall = [MockBuffer, number, ArrayBufferView | ArrayBuffer];

export interface MockBuffer {
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

export function createMockDevice(): GPUComputeDeviceLike {
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

export function createMockEncoder(): GPUCommandEncoderLike & { passes: Array<MockComputePass['record']> } {
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
