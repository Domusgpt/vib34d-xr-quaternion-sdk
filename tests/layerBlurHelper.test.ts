import { describe, expect, it, vi } from 'vitest';
import LayerBlurHelper from '../src/ui/adaptive/renderers/webgpu/LayerBlurHelper.ts';
import type { LayerDescriptor } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';

function createMockDevice() {
  let bufferId = 0;
  const textures: any[] = [];
  const queue = { writeBuffer: vi.fn() };
  return {
    queue,
    createBuffer: vi.fn(() => ({ id: ++bufferId })),
    createBindGroupLayout: vi.fn(descriptor => descriptor),
    createPipelineLayout: vi.fn(descriptor => descriptor),
    createShaderModule: vi.fn(descriptor => descriptor),
    createRenderPipeline: vi.fn(descriptor => descriptor),
    createTexture: vi.fn((descriptor: any) => {
      const texture = {
        descriptor,
        createView: vi.fn(() => ({ descriptor })),
        destroy: vi.fn(),
      };
      textures.push(texture);
      return texture;
    }),
    createBindGroup: vi.fn(descriptor => ({ descriptor })),
    _textures: textures,
  } as any;
}

describe('LayerBlurHelper', () => {
  it('allocates half-resolution blur targets and returns blurred views', () => {
    const device = createMockDevice();
    const layers: LayerDescriptor[] = [
      { name: 'LayerA', pipelineLabel: 'layer-a', blurRadius: 5 },
      { name: 'LayerB', pipelineLabel: 'layer-b' },
    ];

    const helper = new LayerBlurHelper({
      device,
      layers,
      sampler: { id: 'sampler' },
      format: 'rgba16float',
    });

    helper.resize(1024, 768);
    const createdTextures = (device as any)._textures as Array<{ descriptor: any }>;
    expect(createdTextures).toHaveLength(2);
    expect(createdTextures[0]?.descriptor?.size?.width).toBe(512);
    expect(createdTextures[0]?.descriptor?.size?.height).toBe(384);

    const encoder = {
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      })),
    };

    const baseView = { label: 'base-view' };
    const blurredView = helper.encodeBlur(encoder as any, 0, baseView, 1024, 768);
    expect(blurredView).not.toBe(baseView);

    const passthroughView = { label: 'passthrough' };
    const result = helper.encodeBlur(encoder as any, 1, passthroughView, 1024, 768);
    expect(result).toBe(passthroughView);
  });
});
