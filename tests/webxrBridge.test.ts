import { describe, expect, it } from 'vitest';
import { MultiLayerGlassComposer } from '../src/ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge } from '../src/ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import { readField } from '../src/ui/adaptive/renderers/webgpu/BufferLayout.ts';
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
      uniformSize: WebXRQuaternionBridge.uniformByteSize
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
    expect(uniforms.length).toBeGreaterThanOrEqual(WebXRQuaternionBridge.uniformFloatCount);
    expect(device.queue.writes).toHaveLength(1);

    const expectedHeadMatrix = quaternionToMatrix4(orientation);
    expectedHeadMatrix[12] = 1;
    expectedHeadMatrix[13] = 2;
    expectedHeadMatrix[14] = 3;
    const headMatrix = readField(WebXRQuaternionBridge.uniformLayout, uniforms, 'headMatrix');
    for (let i = 0; i < 16; i += 1) {
      expect(headMatrix[i]).toBeCloseTo(expectedHeadMatrix[i], 5);
    }

    const rotor = readField(WebXRQuaternionBridge.uniformLayout, uniforms, 'rotor4d');
    const expectedRotor = quaternionTo4DRotationAngles(orientation);
    expect(rotor[0]).toBeCloseTo(expectedRotor[0], 5);
    expect(rotor[1]).toBeCloseTo(expectedRotor[1], 5);
    expect(rotor[2]).toBeCloseTo(expectedRotor[2], 5);

    const euler = readField(WebXRQuaternionBridge.uniformLayout, uniforms, 'euler');
    const expectedEuler = quaternionToEuler(orientation);
    expect(euler[0]).toBeCloseTo(expectedEuler[0], 5);
    expect(euler[1]).toBeCloseTo(expectedEuler[1], 5);
    expect(euler[2]).toBeCloseTo(expectedEuler[2], 5);

    const metrics = readField(WebXRQuaternionBridge.uniformLayout, uniforms, 'metrics');
    expect(metrics[0]).toBeCloseTo(1000, 5);
    expect(metrics[1]).toBeCloseTo(0, 5);
    expect(metrics[2]).toBeCloseTo(0.8, 5);
    expect(metrics[3]).toBe(1);

    const audio = readField(WebXRQuaternionBridge.uniformLayout, uniforms, 'audio');
    expect(audio[0]).toBeCloseTo(0.4, 5);
    expect(audio[1]).toBeCloseTo(0.2, 5);
    expect(audio[2]).toBeCloseTo(0.1, 5);
    expect(audio[3]).toBeCloseTo(0.4, 5);

    const localization = readField(WebXRQuaternionBridge.uniformLayout, uniforms, 'localization');
    expect(localization[0]).toBeCloseTo(0, 5);
    expect(localization[1]).toBeCloseTo(0, 5);
    expect(localization[2]).toBeCloseTo(0, 5);
    expect(localization[3]).toBeCloseTo(0, 5);
  });

  it('computes deltaTime on subsequent frames and guards missing orientation', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [{ name: 'Layer', pipelineLabel: 'layer' }],
      target: { width: 1024, height: 1024 },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
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
    const metrics = readField(WebXRQuaternionBridge.uniformLayout, second!, 'metrics');
    expect(metrics[1]).toBeCloseTo(16, 5);

    const missingOrientationFrame = { getViewerPose: () => ({ views: [], transform: {} }) } as Parameters<WebXRQuaternionBridge['updateFromXRFrame']>[0];
    const skipped = bridge.updateFromXRFrame(missingOrientationFrame, { referenceSpace: {}, frameTime: 532 });
    expect(skipped).toBeNull();
  });

  it('applies rotor overrides and localization payloads', () => {
    const device = createMockDevice();
    const composer = new MultiLayerGlassComposer({
      device,
      layers: [{ name: 'Layer', pipelineLabel: 'layer' }],
      target: { width: 720, height: 480 },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
    });

    const bridge = new WebXRQuaternionBridge({ composer });
    const orientation = fromAxisAngle([0, 0, 1], Math.PI * 0.33);
    const override: [number, number, number] = [0.1, 0.2, 0.3];

    const frame = { getViewerPose: () => ({
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
            inverse: { matrix: new Float32Array([
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1
            ]) }
          }
        }
      ]
    }) } as Parameters<WebXRQuaternionBridge['updateFromXRFrame']>[0];

    const result = bridge.updateFromXRFrame(frame, {
      referenceSpace: {},
      frameTime: 0,
      rotorOverride: override,
      localization: {
        stageConfidence: 0.6,
        anchorConfidence: 0.4,
        drift: 0.2,
        latencyMs: 45
      }
    });

    expect(result).not.toBeNull();
    const rotor = readField(WebXRQuaternionBridge.uniformLayout, result!, 'rotor4d');
    expect(rotor[0]).toBeCloseTo(override[0], 5);
    expect(rotor[1]).toBeCloseTo(override[1], 5);
    expect(rotor[2]).toBeCloseTo(override[2], 5);

    const localization = readField(WebXRQuaternionBridge.uniformLayout, result!, 'localization');
    expect(localization[0]).toBeCloseTo(0.6, 5);
    expect(localization[1]).toBeCloseTo(0.4, 5);
    expect(localization[2]).toBeCloseTo(0.2, 5);
    expect(localization[3]).toBeCloseTo(0.045, 5);
  });
});
