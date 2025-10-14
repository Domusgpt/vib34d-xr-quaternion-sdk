import { describe, expect, it } from 'vitest';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { createGlassPipelines } from '../src/ui/adaptive/renderers/webgpu/GlassPipelineFactory.ts';
import { WebXRQuaternionBridge } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import type { GPUDeviceRaw } from '../src/ui/adaptive/renderers/webgpu/GPUInterfaces.ts';

type WriteCall = [unknown, number, ArrayBufferView | ArrayBuffer, number?, number?];

interface MockBuffer {
  label: string;
  writes: WriteCall[];
  destroy: () => void;
}

type ShaderRecord = { label?: string; code: string };

type PipelineRecord = { label?: string };

interface MockDevice {
  queue: { writeBuffer: (...args: WriteCall) => void };
  createBuffer: (descriptor: { size: number; usage: number; label?: string }) => MockBuffer;
  createBindGroupLayout: (descriptor: unknown) => unknown;
  createShaderModule: (descriptor: { label?: string; code: string }) => ShaderRecord;
  createPipelineLayout: (descriptor: unknown) => unknown;
  createRenderPipeline: (descriptor: PipelineRecord & { layout: unknown }) => PipelineRecord;
  createSampler: (descriptor: unknown) => unknown;
  shaderRecords: ShaderRecord[];
  pipelineRecords: PipelineRecord[];
}

function createMockDevice(): MockDevice {
  const buffers: MockBuffer[] = [];
  const shaderRecords: ShaderRecord[] = [];
  const pipelineRecords: PipelineRecord[] = [];
  const queue = {
    writeBuffer: (...args: WriteCall) => {
      const [buffer] = args;
      (buffer as MockBuffer).writes.push(args);
    }
  };

  return {
    queue,
    createBuffer: ({ label }) => {
      const buffer: MockBuffer = {
        label: label ?? `buffer-${buffers.length}`,
        writes: [],
        destroy: () => {}
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroupLayout: descriptor => descriptor,
    createShaderModule: descriptor => {
      shaderRecords.push({ label: descriptor.label, code: descriptor.code });
      return { label: descriptor.label, code: descriptor.code };
    },
    createPipelineLayout: descriptor => descriptor,
    createRenderPipeline: descriptor => {
      pipelineRecords.push({ label: descriptor.label });
      return descriptor;
    },
    createSampler: descriptor => descriptor,
    shaderRecords,
    pipelineRecords,
  };
}

describe('createGlassPipelines', () => {
  it('generates distinct WGSL per layer descriptor using the shader library', () => {
    const device = createMockDevice();
    const layers = [
      {
        name: 'Sphere',
        pipelineLabel: 'LayerSphere',
        shader: { geometry: 'hypersphere' as const, projection: 'perspective' as const },
      },
      {
        name: 'Tetra',
        pipelineLabel: 'LayerTetra',
        shader: { geometry: 'hypertetrahedron' as const, projection: 'orthographic' as const },
      },
    ];

    const composer = new MultiLayerGlassComposer({
      device: device as unknown as GPUDeviceRaw,
      layers,
      target: { width: 640, height: 360, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize,
    });

    const pipelines = createGlassPipelines({
      device: device as unknown as GPUDeviceRaw,
      composer,
      layers,
      outputFormat: 'bgra8unorm',
    });

    expect(pipelines.layerPipelines).toHaveLength(2);
    expect(pipelines.layerShaderCodes).toHaveLength(2);
    expect(pipelines.layerShaderCodes[0]).toContain('densityFactor');
    expect(pipelines.layerShaderCodes[1]).toContain('dynamicThickness');

    const layerShaderRecords = device.shaderRecords.filter(record => record.label?.includes('Layer'));
    expect(layerShaderRecords).toHaveLength(2);
    expect(layerShaderRecords[0].code).toContain('calculateLattice');
    expect(layerShaderRecords[1].code).toContain('calculateLattice');

    const layerPipelineRecords = device.pipelineRecords.filter(record => record.label?.includes('Layer'));
    expect(layerPipelineRecords).toHaveLength(2);
  });
});
