import { describe, expect, it } from 'vitest';

import { composeQuaternionUniformBlock } from '../src/core/quaternion/index.ts';
import {
  QUATERNION_BUFFER_HEADER_FLOATS,
  QUATERNION_DEVICE_FLOATS,
  createQuaternionStateBuffer,
  generateQuaternionWgslModule,
  getQuaternionBufferFloatLength,
  hashPoseFrameId,
  resolveQuaternionSlots,
  writePoseFrameToBuffer
} from '../src/core/quaternion/webgpu.ts';
import { poseToDualQuaternion, validatePoseFrame } from '../src/core/quaternion/poseSchema.ts';

function expectArrayClose(actual: ArrayLike<number>, expected: ArrayLike<number>, epsilon = 1e-5) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(epsilon);
  }
}

describe('Quaternion WebGPU bridge', () => {
  it('resolves slots and buffer sizing defaults', () => {
    const slots = resolveQuaternionSlots();
    expect(slots).toEqual([
      { role: 'headset', handedness: 'none' },
      { role: 'controller', handedness: 'left' },
      { role: 'controller', handedness: 'right' }
    ]);

    const length = getQuaternionBufferFloatLength();
    expect(length).toBe(QUATERNION_BUFFER_HEADER_FLOATS + slots.length * QUATERNION_DEVICE_FLOATS);

    const buffer = createQuaternionStateBuffer();
    expect(buffer.length).toBe(length);
  });

  it('packs validated pose frames into GPU-ready layout', () => {
    const frame = validatePoseFrame({
      frameId: 'frame-42',
      timestamp: 123_456,
      referenceSpace: 'local-floor',
      head: {
        id: 'head-0',
        role: 'headset',
        handedness: 'none',
        timestamp: 123_450,
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        position: { x: 0, y: 1.6, z: 0 },
        reliability: 'tracked'
      },
      controllers: [
        {
          id: 'left-controller',
          role: 'controller',
          handedness: 'left',
          timestamp: 123_452,
          orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
          position: { x: -0.3, y: 1.4, z: 0.2 },
          linearVelocity: { x: 0.5, y: 0.1, z: 0 },
          angularVelocity: { x: 0, y: 1.2, z: 0.2 },
          reliability: 'tracked',
          accuracy: 0.2
        },
        {
          id: 'right-controller',
          role: 'controller',
          handedness: 'right',
          timestamp: 123_454,
          orientation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
          position: { x: 0.35, y: 1.35, z: 0.15 },
          reliability: 'estimated',
          accuracy: 0.5
        }
      ],
      metadata: {}
    });

    const config = { includeHands: true } as const;
    const buffer = createQuaternionStateBuffer(config);
    const { deviceMask, slots } = writePoseFrameToBuffer(frame, buffer, config);

    const headerU32 = new Uint32Array(buffer.buffer, buffer.byteOffset, QUATERNION_BUFFER_HEADER_FLOATS);
    const headerF32 = new Float32Array(buffer.buffer, buffer.byteOffset, QUATERNION_BUFFER_HEADER_FLOATS);

    expect(headerU32[0]).toBe(hashPoseFrameId(frame.frameId));
    expect(headerF32[1]).toBeCloseTo(frame.timestamp / 1000, 5);
    expect(headerU32[2]).toBe(1); // local-floor mapping
    expect(headerU32[3]).toBe(deviceMask);

    expect(slots.length).toBe(5);
    expect(deviceMask).toBe(0b00111);

    const headBlock = buffer.subarray(QUATERNION_BUFFER_HEADER_FLOATS, QUATERNION_BUFFER_HEADER_FLOATS + 8);
    expectArrayClose(headBlock, composeQuaternionUniformBlock(poseToDualQuaternion(frame.head)));

    const leftOffset = QUATERNION_BUFFER_HEADER_FLOATS + QUATERNION_DEVICE_FLOATS * 1;
    const leftOrientationBlock = buffer.subarray(leftOffset, leftOffset + 8);
    expectArrayClose(
      leftOrientationBlock,
      composeQuaternionUniformBlock(poseToDualQuaternion(frame.controllers[0]))
    );

    const leftLinear = buffer.subarray(leftOffset + 8, leftOffset + 12);
    expectArrayClose(leftLinear, [0.5, 0.1, 0, Math.hypot(0.5, 0.1, 0)]);

    const leftAngular = buffer.subarray(leftOffset + 12, leftOffset + 16);
    expectArrayClose(leftAngular, [0, 1.2, 0.2, Math.hypot(0, 1.2, 0.2)]);

    const leftMetadata = buffer.subarray(leftOffset + 16, leftOffset + 20);
    expect(leftMetadata[0]).toBeCloseTo(1 / 1.2, 5);
    expect(leftMetadata[1]).toBe(2); // tracked reliability code
    expect(leftMetadata[2]).toBeCloseTo(0.2, 5);
    expect(leftMetadata[3]).toBe(123_452 - frame.timestamp);

    const rightOffset = QUATERNION_BUFFER_HEADER_FLOATS + QUATERNION_DEVICE_FLOATS * 2;
    const rightMetadata = buffer.subarray(rightOffset + 16, rightOffset + 20);
    const expectedConfidence = 0.6 * (1 / (1 + 0.5));
    expect(rightMetadata[0]).toBeCloseTo(expectedConfidence, 5);
    expect(rightMetadata[1]).toBe(1);

    const leftHandOffset = QUATERNION_BUFFER_HEADER_FLOATS + QUATERNION_DEVICE_FLOATS * 3;
    const leftHandBlock = buffer.subarray(leftHandOffset, leftHandOffset + 8);
    expectArrayClose(leftHandBlock, [0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('generates customizable WGSL module strings', () => {
    const moduleSource = generateQuaternionWgslModule({
      deviceStructName: 'DeviceState',
      headerStructName: 'FrameHeader'
    });
    expect(moduleSource).toContain('struct FrameHeader');
    expect(moduleSource).toContain('struct DeviceState');
    expect(moduleSource).toContain('decode_device_confidence');
  });

  it('hashes frame identifiers deterministically', () => {
    expect(hashPoseFrameId('frame-42')).toBe(hashPoseFrameId('frame-42'));
    expect(hashPoseFrameId('frame-42')).not.toBe(hashPoseFrameId('frame-43'));
  });
});
