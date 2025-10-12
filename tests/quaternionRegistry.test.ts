import { describe, expect, it } from 'vitest';

import { QuaternionPoseRegistry } from '../src/core/quaternion/registry.ts';
import {
  dualQuaternionFromRotationTranslation,
  dualQuaternionLerp,
  extractTranslation,
  fromAxisAngle,
  type DualQuaternion,
  type Quaternion,
  type Vec3
} from '../src/core/quaternion/index.ts';
import { type XRPoseFramePayload } from '../src/core/quaternion/poseSchema.ts';

const BASE_POSITION: Vec3 = [0.05, 1.6, -0.1];

function createFrame(
  orientation: Quaternion,
  timestamp: number,
  overrides: Partial<XRPoseFramePayload> = {}
): XRPoseFramePayload {
  return {
    frameId: `frame-${timestamp}`,
    timestamp,
    referenceSpace: 'local-floor',
    head: {
      id: 'headset-main',
      role: 'headset',
      handedness: 'none',
      timestamp,
      orientation: toQuaternionPayload(orientation),
      position: toVectorPayload([0, 1.65, 0]),
      reliability: 'tracked'
    },
    controllers: [
      {
        id: 'controller-left',
        role: 'controller',
        handedness: 'left',
        timestamp,
        orientation: toQuaternionPayload(orientation),
        position: toVectorPayload(BASE_POSITION),
        reliability: 'tracked',
        buttons: [1, 0.5],
        triggers: [0.25]
      }
    ],
    hands: [],
    ...overrides
  };
}

function toQuaternionPayload([x, y, z, w]: Quaternion) {
  return { x, y, z, w };
}

function toVectorPayload([x, y, z]: Vec3) {
  return { x, y, z };
}

function closeDualQuaternion(a: DualQuaternion | null, b: DualQuaternion): boolean {
  if (!a) {
    return false;
  }
  return isClose(a, b) || isClose(a, negateDualQuaternion(b));
}

function isClose(a: DualQuaternion, b: DualQuaternion): boolean {
  return a.real.every((value, index) => Math.abs(value - b.real[index]) < 1e-4) &&
    a.dual.every((value, index) => Math.abs(value - b.dual[index]) < 1e-4);
}

function negateDualQuaternion(dq: DualQuaternion): DualQuaternion {
  return {
    real: dq.real.map(value => -value) as DualQuaternion['real'],
    dual: dq.dual.map(value => -value) as DualQuaternion['dual']
  };
}

describe('QuaternionPoseRegistry', () => {
  it('ingests XR pose frames and exposes device state snapshots', () => {
    const registry = new QuaternionPoseRegistry();
    const orientation = fromAxisAngle([0, 1, 0], Math.PI / 6);
    const frame = createFrame(orientation, 1000);

    registry.ingestFrame(frame);

    expect(registry.size).toBe(2);
    const head = registry.getDevice('headset-main');
    const controller = registry.getDevice('controller-left');

    expect(head?.role).toBe('headset');
    expect(head?.current.orientation[3]).toBeCloseTo(orientation[3]);
    expect(controller?.role).toBe('controller');
    expect(controller?.current.position).toEqual(BASE_POSITION);
    expect(controller).not.toBeNull();
    if (!controller) {
      throw new Error('controller state missing');
    }
    const translation = extractTranslation(controller.current.dualQuaternion);
    translation.forEach((value, index) => {
      expect(value).toBeCloseTo(BASE_POSITION[index], 6);
    });
  });

  it('interpolates dual quaternions between buffered frames', () => {
    const registry = new QuaternionPoseRegistry();
    const startOrientation = fromAxisAngle([0, 1, 0], 0);
    const endOrientation = fromAxisAngle([0, 1, 0], Math.PI / 2);

    registry.ingestFrame(createFrame(startOrientation, 0));
    registry.ingestFrame(createFrame(endOrientation, 16));

    const interpolated = registry.getInterpolatedDualQuaternion('headset-main', 0.5);
    const startDual = dualQuaternionFromRotationTranslation(startOrientation, [0, 1.65, 0]);
    const endDual = dualQuaternionFromRotationTranslation(endOrientation, [0, 1.65, 0]);
    const expected = dualQuaternionLerp(startDual, endDual, 0.5);

    expect(closeDualQuaternion(interpolated, expected)).toBe(true);
  });

  it('prunes stale device entries after the configured retention window', () => {
    const registry = new QuaternionPoseRegistry({ retentionMs: 5 });
    const orientation = fromAxisAngle([0, 0, 1], Math.PI / 8);

    registry.ingestFrame(createFrame(orientation, 0));
    registry.prune(10);

    expect(registry.size).toBe(0);
    expect(registry.getDevice('controller-left')).toBeNull();
  });
});
