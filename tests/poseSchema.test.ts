import { describe, expect, it } from 'vitest';

import {
  XRPoseValidationError,
  poseQuaternionToTuple,
  poseToDualQuaternion,
  validatePoseFrame,
  type XRPoseFramePayload
} from '../src/core/quaternion/poseSchema.ts';
import {
  dualQuaternionFromRotationTranslation,
  fromAxisAngle,
  type DualQuaternion
} from '../src/core/quaternion/index.ts';

const basePoseFrame: XRPoseFramePayload = {
  frameId: 'frame-1',
  timestamp: 1234.5,
  referenceSpace: 'local-floor',
  head: {
    id: 'headset-main',
    role: 'headset',
    handedness: 'none',
    timestamp: 1234.5,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    position: { x: 0, y: 1.65, z: 0 },
    reliability: 'tracked'
  },
  controllers: [
    {
      id: 'controller-left',
      role: 'controller',
      handedness: 'left',
      timestamp: 1234.2,
      orientation: { x: 0, y: 0.707, z: 0, w: 0.707 },
      position: { x: -0.3, y: 1.4, z: 0.2 },
      reliability: 'tracked',
      buttons: [1, 0.5]
    }
  ],
  hands: []
};

describe('XR pose schema validation', () => {
  it('validates and normalizes pose frames', () => {
    const validated = validatePoseFrame({ ...basePoseFrame, controllers: undefined });
    expect(validated.controllers).toEqual([]);
    expect(validated.head.role).toBe('headset');
  });

  it('throws on invalid payloads', () => {
    expect(() =>
      validatePoseFrame({
        ...basePoseFrame,
        head: {
          ...basePoseFrame.head,
          orientation: { x: 0, y: 0, z: 0 }
        } as never
      })
    ).toThrowError(XRPoseValidationError);

    expect(() =>
      validatePoseFrame({
        ...basePoseFrame,
        head: {
          ...basePoseFrame.head,
          orientation: { x: 0, y: 0, z: 0 }
        } as never
      })
    ).toThrowError(/orientation must have required property 'w'/);
  });

  it('converts pose payloads into dual quaternions', () => {
    const orientation = fromAxisAngle([0, 1, 0], Math.PI / 4);
    const expected = dualQuaternionFromRotationTranslation(orientation, [0.1, 1.2, -0.5]);
    const pose = {
      id: 'controller-right',
      role: 'controller' as const,
      handedness: 'right' as const,
      timestamp: 999,
      orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] },
      position: { x: 0.1, y: 1.2, z: -0.5 },
      reliability: 'tracked'
    };

    const dualQuat = poseToDualQuaternion(pose);
    expect(poseQuaternionToTuple(pose.orientation)).toEqual(orientation);
    expect(closeDualQuaternion(dualQuat, expected)).toBe(true);
  });
});

function closeDualQuaternion(a: DualQuaternion, b: DualQuaternion): boolean {
  return a.real.every((value, index) => Math.abs(value - b.real[index]) < 1e-4) &&
    a.dual.every((value, index) => Math.abs(value - b.dual[index]) < 1e-4);
}
