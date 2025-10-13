import { describe, expect, it } from 'vitest';
import GlassUniformController from '../src/ui/adaptive/renderers/webgpu/GlassUniformController.ts';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import { LocalizationBridge } from '../src/ui/adaptive/localization/LocalizationBridge.ts';
import { createMockXRFrame } from '../src/dev/webgpuPreviewHarness.ts';

interface MockBuffer {
  id: number;
  label: string;
  writes: WriteCall[];
  destroy: () => void;
}

type WriteCall = [MockBuffer, number, ArrayBufferView | ArrayBuffer, number?, number?];

interface MockDevice {
  queue: { writeBuffer: (...args: WriteCall) => void };
  createBuffer: (descriptor: { size: number; usage: number; label?: string }) => MockBuffer;
  buffers: MockBuffer[];
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
    },
    buffers
  };
}

describe('GlassUniformController', () => {
  it('normalizes quaternions and uploads uniforms through the bridge', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [{ name: 'LayerA', pipelineLabel: 'layer-a' }],
      target: { width: 512, height: 512, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
    });

    const controller = new GlassUniformController({ composer });
    controller.setQuaternion([0.4, 0.2, -0.3, 0.8]);
    controller.setAudioBands({ bass: 0.2, mid: 0.3, high: 0.4, energy: 0.5 });
    controller.setVisualParams({ dimension: 3.6, morphFactor: 0.5, rotationSpeed: 0.4, universeModifier: 1.1 });
    controller.setConfidence(0.75);
    controller.setMaterialParams({
      gridDensity: 14,
      lineThickness: 0.04,
      shellWidth: 0.03,
      tetraThickness: 0.04,
      patternIntensity: 1.2,
      glitchIntensity: 0.15,
      colorShift: 0.2,
    });
    controller.setPalette({
      primary: [0.8, 0.3, 0.9],
      secondary: [0.1, 0.9, 0.95],
      background: [0.02, 0.01, 0.15],
    });
    controller.setResolution([1920, 1080]);

    const frame = createMockXRFrame({
      quaternion: [0.2, 0.1, 0.05, 0.97] as [number, number, number, number],
      aspect: 1.2,
      fovY: Math.PI / 2.1,
      ipd: 0.064
    });

    const uniforms = controller.update(frame, {
      referenceSpace: {},
      frameTime: 1.25,
      deltaTime: 0.016,
      quaternionOverride: [0.2, 0.1, 0.05, 0.97],
      materialOverride: {
        geometry: 'hypersphere',
        projection: 'stereographic',
      },
    });

    expect(uniforms).not.toBeNull();
    expect(device.buffers.some(buffer => buffer.writes.length > 0)).toBe(true);
    expect(controller.getLastFusion()).not.toBeNull();
    expect(controller.getLastAudio().energy).toBeGreaterThanOrEqual(0.5);
    expect(controller.getLastMaterial().geometry).toBe('hypersphere');
    expect(controller.getLastPalette().primary[0]).toBeCloseTo(0.8, 3);
    expect(controller.getLastResolution()[0]).toBe(1920);
  });

  it('reports localization risks when latency and drift are high', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [{ name: 'LayerA', pipelineLabel: 'layer-a' }],
      target: { width: 256, height: 256, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
    });

    const localizationBridge = new LocalizationBridge({ timeSource: () => 2000 });
    const controller = new GlassUniformController({ composer, localizationBridge });
    controller.setQuaternion([0, 0, 0, 1]);
    controller.setConfidence(0.4);

    controller.ingestLocalizationFrame({
      source: 'openxr-stage',
      timestamp: 1900,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        position: { x: 0, y: 0, z: 0 }
      },
      mappingStatus: 'limited',
      trackingState: 'limited',
      accuracy: 0.3,
      drift: 0.6,
      anchor: { id: 'stage', accuracy: 0.3 }
    });

    controller.ingestLocalizationFrame({
      source: 'spatial-anchor',
      timestamp: 1890,
      referenceSpace: 'local-floor',
      anchor: {
        id: 'anchor-1',
        transform: {
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          position: { x: 0.1, y: 0.2, z: -0.1 }
        },
        accuracy: 0.25
      },
      drift: 0.55
    });

    const risks = controller.listLocalizationRisks();
    expect(risks.some(risk => risk.toLowerCase().includes('latency'))).toBe(true);
  });
});
