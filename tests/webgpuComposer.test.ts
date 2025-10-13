import { describe, expect, it } from 'vitest';
import { TripleBufferedUniform } from '../src/ui/adaptive/renderers/webgpu/TripleBufferedUniform.ts';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';

type WriteCall = [MockBuffer, number, ArrayBufferView | ArrayBuffer, number?, number?];

interface MockBuffer {
  id: number;
  label: string;
  writes: WriteCall[];
  destroy: () => void;
}

interface MockDevice {
  queue: { writeBuffer: (...args: WriteCall) => void };
  createBuffer: (descriptor: { size: number; usage: number; label?: string }) => MockBuffer;
}

function createMockDevice(): MockDevice {
  const buffers: MockBuffer[] = [];
  const queue = {
    writeBuffer: (...args: WriteCall) => {
      const [buffer] = args;
      buffer.writes.push(args);
    }
  };

  return {
    queue,
    createBuffer: ({ size, usage, label }) => {
      if (!Number.isFinite(size) || size <= 0) {
        throw new Error('Invalid buffer size');
      }
      if (!Number.isFinite(usage)) {
        throw new Error('Invalid usage flags');
      }
      const buffer: MockBuffer = {
        id: buffers.length,
        label: label ?? `buffer-${buffers.length}`,
        writes: [],
        destroy: () => {}
      };
      buffers.push(buffer);
      return buffer;
    }
  };
}

describe('TripleBufferedUniform', () => {
  it('rotates buffers and records writes without hazards', () => {
    const device = createMockDevice();
    const ring = new TripleBufferedUniform(device, 64, { bufferCount: 3, label: 'TestUniform' });

    expect(ring.writeIndex).toBe(0);
    ring.update(new Float32Array([1, 2, 3]));
    expect(ring.writeIndex).toBe(1);
    expect(ring.bindIndex).toBe(0);
    expect(ring.bindBuffer).toBeDefined();

    ring.update(new Float32Array([4, 5, 6]));
    expect(ring.writeIndex).toBe(2);
    expect(ring.bindIndex).toBe(1);

    ring.update(new Float32Array([7, 8, 9]));
    expect(ring.writeIndex).toBe(0);
    expect(ring.bindIndex).toBe(2);

    const entry = ring.bindGroupEntry();
    expect(entry.resource.buffer).toBe(ring.bindBuffer);
  });
});

describe('MultiLayerGlassComposer', () => {
  it('builds pass plans and texture descriptors for the configured layers', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [
        { name: 'Backplate', pipelineLabel: 'backplate', blurRadius: 7 },
        { name: 'Particles', pipelineLabel: 'particles' }
      ],
      target: { width: 1920, height: 1080 },
      uniformSize: 256
    });

    const textures = composer.buildLayerTextureDescriptors();
    expect(textures).toHaveLength(2);
    expect(textures[0]).toEqual({ name: 'Backplate-target', usage: 0x04 | 0x10, format: 'rgba16float' });

    expect(composer.passPlan[0].blur?.radius).toBe(7);
    expect(composer.passPlan[1].blur).toBeUndefined();

    composer.updateUniforms(new Float32Array([0, 0, 0, 1]));
    const entry = composer.getUniformBindGroupEntry();
    expect(entry.resource.buffer).toBeDefined();
    expect(composer.summarizeRisks()).toHaveLength(0);
  });

  it('reports configuration risks when exceeding mobile GPU budgets', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [
        { name: 'Layer1', pipelineLabel: 'p1' },
        { name: 'Layer2', pipelineLabel: 'p2' },
        { name: 'Layer3', pipelineLabel: 'p3' },
        { name: 'Layer4', pipelineLabel: 'p4' },
        { name: 'Layer5', pipelineLabel: 'p5' },
        { name: 'Layer6', pipelineLabel: 'p6' }
      ],
      target: { width: 8192, height: 4096, format: 'rgba8unorm' },
      uniformSize: 512
    });

    const risks = composer.summarizeRisks();
    expect(risks.some(risk => risk.includes('4k'))).toBe(true);
    expect(risks.some(risk => risk.includes('banding'))).toBe(true);
    expect(risks.some(risk => risk.includes('bandwidth'))).toBe(true);
  });
});
