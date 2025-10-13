import { describe, expect, it } from 'vitest';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import type { GPUDeviceLike, GPUBufferLike } from '../src/ui/adaptive/renderers/webgpu/TripleBufferedUniform.ts';
import { fromAxisAngle, quaternionToEuler, quaternionToMatrix4, quaternionTo4DRotationAngles } from '../src/core/quaternion/index.ts';

interface MockBuffer extends GPUBufferLike {
  readonly id: number;
  writes: WriteRecord[];
}

interface WriteRecord {
  readonly buffer: MockBuffer;
  readonly offset: number;
  readonly data: ArrayBufferView | ArrayBuffer;
  readonly dataOffset?: number;
  readonly size?: number;
}

interface MockQueue {
  writes: WriteRecord[];
  writeBuffer: (buffer: MockBuffer, offset: number, data: ArrayBufferView | ArrayBuffer, dataOffset?: number, size?: number) => void;
}

interface MockDevice extends GPUDeviceLike {
  readonly queue: MockQueue;
  readonly buffers: MockBuffer[];
}

function createMockDevice(): MockDevice {
  const buffers: MockBuffer[] = [];
  const writes: WriteRecord[] = [];
  const queue: MockQueue = {
    writes,
    writeBuffer: (buffer, offset, data, dataOffset, size) => {
      const record: WriteRecord = { buffer, offset, data, dataOffset, size };
      buffer.writes.push(record);
      writes.push(record);
    }
  };

  return {
    queue,
    buffers,
    createBuffer: ({ label, size }) => {
      const buffer: MockBuffer = {
        id: buffers.length,
        label,
        size,
        writes: []
      };
      buffers.push(buffer);
      return buffer;
    }
  } as MockDevice;
}

describe('WebXRQuaternionBridge', () => {
  it('packs viewer pose data into the glass composer uniform buffer', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [
        { name: 'Back', pipelineLabel: 'back' },
        { name: 'Front', pipelineLabel: 'front' }
      ],
      target: { width: 1920, height: 1080 },
      uniformSize: 64 * Float32Array.BYTES_PER_ELEMENT
    });

    const bridge = new WebXRQuaternionBridge({ composer });

    const halfPi = Math.PI * 0.5;
    const orientation = fromAxisAngle([0, 1, 0], halfPi);
    const frame = {
      getViewerPose: () => ({
        transform: {
          orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] },
          position: { x: 1, y: 2, z: 3 }
        },
        views: [
          {
            projectionMatrix: new Float32Array([
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1
            ]),
            transform: {
              orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] },
              position: { x: 1, y: 2, z: 3 },
              inverse: {
                matrix: new Float32Array([
                  1, 0, 0, 0,
                  0, 1, 0, 0,
                  0, 0, 1, 0,
                  0, 0, 0, 1
                ])
              }
            }
          }
        ]
      })
    } satisfies Parameters<WebXRQuaternionBridge['updateFromXRFrame']>[0];

    const result = bridge.updateFromXRFrame(frame, {
      referenceSpace: {},
      frameTime: 1000,
      confidence: 0.8,
      audio: { bass: 0.4, mid: 0.2, high: 0.1 }
    });

    expect(result).not.toBeNull();
    const uniforms = result!;
    expect(uniforms.length).toBeGreaterThanOrEqual(64);
    expect(device.queue.writes).toHaveLength(1);

    const expectedHeadMatrix = quaternionToMatrix4(orientation);
    expectedHeadMatrix[12] = 1;
    expectedHeadMatrix[13] = 2;
    expectedHeadMatrix[14] = 3;
    for (let i = 0; i < 16; i += 1) {
      expect(uniforms[32 + i]).toBeCloseTo(expectedHeadMatrix[i], 5);
    }

    const expectedRotor = quaternionTo4DRotationAngles(orientation);
    expect(uniforms[48]).toBeCloseTo(expectedRotor[0], 5);
    expect(uniforms[49]).toBeCloseTo(expectedRotor[1], 5);
    expect(uniforms[50]).toBeCloseTo(expectedRotor[2], 5);

    const expectedEuler = quaternionToEuler(orientation);
    expect(uniforms[52]).toBeCloseTo(expectedEuler[0], 5);
    expect(uniforms[53]).toBeCloseTo(expectedEuler[1], 5);
    expect(uniforms[54]).toBeCloseTo(expectedEuler[2], 5);

    expect(uniforms[56]).toBeCloseTo(1000, 5);
    expect(uniforms[57]).toBeCloseTo(0, 5);
    expect(uniforms[58]).toBeCloseTo(0.8, 5);
    expect(uniforms[59]).toBe(1);

    expect(uniforms[60]).toBeCloseTo(0.4, 5);
    expect(uniforms[61]).toBeCloseTo(0.2, 5);
    expect(uniforms[62]).toBeCloseTo(0.1, 5);
    expect(uniforms[63]).toBeCloseTo(0.4, 5);
  });

  it('computes deltaTime on subsequent frames and guards missing orientation', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [{ name: 'Layer', pipelineLabel: 'layer' }],
      target: { width: 1024, height: 1024 },
      uniformSize: 64 * Float32Array.BYTES_PER_ELEMENT
    });

    const bridge = new WebXRQuaternionBridge({ composer });
    const orientation = fromAxisAngle([1, 0, 0], Math.PI * 0.25);

    const pose = {
      transform: {
        orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] }
      },
      views: [
        {
          projectionMatrix: new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
          ]),
          transform: {
            orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] },
            inverse: {
              matrix: new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
              ])
            }
          }
        }
      ]
    };

    const frame = { getViewerPose: () => pose } as Parameters<WebXRQuaternionBridge['updateFromXRFrame']>[0];

    const first = bridge.updateFromXRFrame(frame, { referenceSpace: {}, frameTime: 500 });
    expect(first).not.toBeNull();

    const second = bridge.updateFromXRFrame(frame, { referenceSpace: {}, frameTime: 516 });
    expect(second).not.toBeNull();
    expect(second![57]).toBeCloseTo(16, 5);

    const missingOrientationFrame = { getViewerPose: () => ({ views: [], transform: {} }) } as Parameters<WebXRQuaternionBridge['updateFromXRFrame']>[0];
    const skipped = bridge.updateFromXRFrame(missingOrientationFrame, { referenceSpace: {}, frameTime: 532 });
    expect(skipped).toBeNull();
  });
});
