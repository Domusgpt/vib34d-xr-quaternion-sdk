import { describe, expect, it, vi } from 'vitest';
import { WebXRGlassSession } from '../src/ui/adaptive/renderers/webgpu/WebXRGlassSession.ts';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import type { XRFrameLike } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import type GlassUniformController from '../src/ui/adaptive/renderers/webgpu/GlassUniformController.ts';

function createMockDevice() {
  let bufferId = 0;
  const passes: any[] = [];
  const encoderFinish = vi.fn(() => ({ id: 'command-buffer' }));

  const device = {
    queue: {
      submit: vi.fn(),
      writeBuffer: vi.fn(),
    },
    createBuffer: vi.fn(() => ({ id: bufferId += 1, destroy: vi.fn() })),
    createSampler: vi.fn(() => ({ id: 'sampler' })),
    createTexture: vi.fn((descriptor: Record<string, unknown>) => ({
      descriptor,
      views: [] as unknown[],
      createView: vi.fn(() => ({ descriptor })),
      destroy: vi.fn(),
    })),
    createBindGroupLayout: vi.fn(descriptor => ({ descriptor })),
    createPipelineLayout: vi.fn(descriptor => ({ descriptor })),
    createShaderModule: vi.fn(descriptor => ({ descriptor })),
    createRenderPipeline: vi.fn(descriptor => ({ descriptor, label: descriptor?.label })),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((descriptor: Record<string, unknown>) => {
        const pass = {
          descriptor,
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
          setViewport: vi.fn(),
        };
        passes.push(pass);
        return pass;
      }),
      finish: encoderFinish,
    })),
    createBindGroup: vi.fn(descriptor => ({ descriptor })),
    _passes: passes,
    _finish: encoderFinish,
  };

  return device;
}

describe('WebXRGlassSession', () => {
  it('streams controller updates into layered WebXR render passes', async () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [
        { name: 'FrostedShell', pipelineLabel: 'LayerFrost' },
        { name: 'Highlights', pipelineLabel: 'LayerHighlights' },
      ],
      target: { width: 640, height: 480, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize,
    });

    const controller = {
      update: vi.fn(() => new Float32Array(WebXRQuaternionBridge.uniformFloatCount)),
      listLocalizationRisks: vi.fn(() => ['Rotor jitter risk']),
    } as unknown as GlassUniformController;

    const projectionLayer = {};
    const colorTexture = {
      createView: vi.fn(() => ({ label: 'view' })),
    } as const;
    const subImage = {
      colorTexture,
      textureWidth: 800,
      textureHeight: 600,
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      getViewDescriptor: vi.fn(() => ({ dimension: '2d' })),
    };

    const binding = {
      getPreferredColorFormat: vi.fn(() => 'bgra8unorm'),
      createProjectionLayer: vi.fn(() => projectionLayer),
      getViewSubImage: vi.fn(() => subImage),
    };

    let frameCallback: ((time: number, frame: XRFrameLike) => void) | null = null;
    const session = {
      requestReferenceSpace: vi.fn(async () => ({})),
      requestAnimationFrame: vi.fn((callback: (time: number, frame: XRFrameLike) => void) => {
        frameCallback = callback;
        return 1;
      }),
      cancelAnimationFrame: vi.fn(),
      updateRenderState: vi.fn(),
      end: vi.fn(async () => {}),
    };

    const xrSystem = {
      requestSession: vi.fn(async () => session),
    };

    const sessionHarness = new WebXRGlassSession({
      device,
      composer,
      controller,
      xr: xrSystem,
      bindingFactory: () => binding,
    });

    await sessionHarness.start();
    expect(xrSystem.requestSession).toHaveBeenCalledWith('immersive-vr', undefined);
    expect(binding.createProjectionLayer).toHaveBeenCalled();

    const mockPose = {
      views: [
        { transform: { orientation: { x: 0, y: 0, z: 0, w: 1 }, inverse: { matrix: new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) } }, projectionMatrix: new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) },
        { transform: { orientation: { x: 0, y: 0, z: 0, w: 1 }, inverse: { matrix: new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) } }, projectionMatrix: new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) },
      ],
      transform: { orientation: { x: 0, y: 0, z: 0, w: 1 } },
    };

    const frame: XRFrameLike = {
      getViewerPose: vi.fn(() => mockPose),
    };

    expect(frameCallback).toBeTypeOf('function');
    frameCallback?.(16, frame);

    expect(controller.update).toHaveBeenCalled();
    expect(device.createCommandEncoder).toHaveBeenCalled();
    expect(device.queue.submit).toHaveBeenCalledTimes(1);

    const passes = (device as any)._passes as Array<{ setPipeline: ReturnType<typeof vi.fn> }>;
    expect(passes.length).toBeGreaterThan(0);
    expect(passes[0]?.setPipeline).toHaveBeenCalled();

    const risks = sessionHarness.listRisks();
    expect(risks).toContain('Rotor jitter risk');
  });
});
