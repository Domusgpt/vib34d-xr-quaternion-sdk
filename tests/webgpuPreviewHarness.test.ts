import { describe, expect, it } from 'vitest';
import { makePerspectiveMatrix, createMockXRFrame } from '../src/dev/webgpuPreviewHarness.ts';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import { readField } from '../src/ui/adaptive/renderers/webgpu/BufferLayout.ts';

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

describe('makePerspectiveMatrix', () => {
  it('produces a perspective matrix with expected scaling terms', () => {
    const aspect = 1.6;
    const fovY = Math.PI / 2.5;
    const matrix = makePerspectiveMatrix(fovY, aspect, 0.1, 32);
    const f = 1 / Math.tan(fovY / 2);
    expect(matrix[0]).toBeCloseTo(f / aspect, 5);
    expect(matrix[5]).toBeCloseTo(f, 5);
    expect(matrix[11]).toBeCloseTo(-1, 5);
  });
});

describe('createMockXRFrame', () => {
  it('returns a viewer pose with mirrored eye views', () => {
    const frame = createMockXRFrame({
      quaternion: [0.1, -0.2, 0.3, 0.9] as [number, number, number, number],
      aspect: 1.4,
      fovY: Math.PI / 3,
      ipd: 0.064
    });
    const pose = frame.getViewerPose({});
    expect(pose).not.toBeNull();
    expect(pose?.views).toHaveLength(2);
    const [left, right] = pose!.views;
    expect(left.transform.orientation?.x).toBeCloseTo(0.1, 5);
    expect(right.transform.orientation?.z).toBeCloseTo(0.3, 5);
    expect(left.projectionMatrix?.[0]).toBeCloseTo(right.projectionMatrix?.[0] ?? 0, 5);
  });
});

describe('WebXRQuaternionBridge with mock frame', () => {
  it('packs pose, audio, and timing data into the composer uniform ring', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [{ name: 'LayerA', pipelineLabel: 'layer-a' }],
      target: { width: 640, height: 480, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
    });
    const bridge = new WebXRQuaternionBridge({ composer });
    const frame = createMockXRFrame({
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      aspect: 1,
      fovY: Math.PI / 2,
      ipd: 0.064
    });

    const uniforms = bridge.updateFromXRFrame(frame, {
      referenceSpace: {},
      frameTime: 1.234,
      deltaTime: 0.016,
      audio: { bass: 0.25, mid: 0.5, high: 0.75 },
      confidence: 0.85
    });

    expect(uniforms).not.toBeNull();
    const metrics = readField(WebXRQuaternionBridge.uniformLayout, uniforms!, 'metrics');
    expect(metrics[0]).toBeCloseTo(1.234, 4);
    expect(metrics[1]).toBeCloseTo(0.016, 4);
    expect(metrics[2]).toBeCloseTo(0.85, 4);

    const audio = readField(WebXRQuaternionBridge.uniformLayout, uniforms!, 'audio');
    expect(audio[0]).toBeCloseTo(0.25, 4);
    expect(audio[2]).toBeCloseTo(0.75, 4);
  });
});
