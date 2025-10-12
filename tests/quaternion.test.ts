import { describe, expect, it } from 'vitest';

import {
  IDENTITY_QUATERNION,
  blendDualQuaternionArray,
  composeRotorFromDualQuaternion,
  createQuaternion,
  dualQuaternionFromRotationTranslation,
  dualQuaternionToMatrix4,
  extractTranslation,
  fromAxisAngle,
  multiply,
  normalize,
  quaternionToMatrix3,
  quaternionToUniformArray,
  slerp
} from '../src/core/quaternion/index.ts';

describe('Quaternion math core', () => {
  it('normalizes quaternions and exports identity', () => {
    const q = createQuaternion(0, 0, 0, 10);
    const normal = normalize(q);
    expect(normal).toEqual(IDENTITY_QUATERNION);
  });

  it('multiplies quaternions following Hamilton product', () => {
    const a = fromAxisAngle([1, 0, 0], Math.PI / 2);
    const b = fromAxisAngle([0, 1, 0], Math.PI / 2);
    const ab = multiply(a, b);
    const m = quaternionToMatrix3(ab);
    expect(closeTo(m[0], 0)).toBe(true);
    expect(closeTo(m[4], 0)).toBe(true);
    expect(closeTo(m[8], 0)).toBe(true);
  });

  it('interpolates via slerp', () => {
    const a = IDENTITY_QUATERNION;
    const b = fromAxisAngle([0, 0, 1], Math.PI);
    const mid = slerp(a, b, 0.5);
    const uniform = quaternionToUniformArray(mid);
    expect(closeTo(uniform[3], Math.SQRT1_2)).toBe(true);
  });
});

describe('Dual quaternion utilities', () => {
  it('builds dual quaternions from rotation + translation', () => {
    const dq = dualQuaternionFromRotationTranslation(
      fromAxisAngle([0, 1, 0], Math.PI / 2),
      [1, 2, 3]
    );
    const translation = extractTranslation(dq);
    expectVec3Close(translation, [1, 2, 3]);
  });

  it('converts to matrices and preserves translation', () => {
    const dq = dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [5, -2, 9]);
    const matrix = dualQuaternionToMatrix4(dq);
    expectVec3Close([matrix[12], matrix[13], matrix[14]], [5, -2, 9]);
  });

  it('blends multiple dual quaternions with weights', () => {
    const dq = blendDualQuaternionArray(
      [
        dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]),
        dualQuaternionFromRotationTranslation(fromAxisAngle([0, 0, 1], Math.PI / 2), [0, 1, 0])
      ],
      [0.25, 0.75]
    );
    const rotor = composeRotorFromDualQuaternion(dq);
    const translation = extractTranslation(dq);
    expect(closeTo(Math.hypot(...translation), 0.75, 5e-2)).toBe(true);
    expect(closeTo(rotor.yw, translation[1], 5e-2)).toBe(true);
  });
});

function closeTo(value: number, expected: number, epsilon = 1e-3): boolean {
  return Math.abs(value - expected) < epsilon;
}

function expectVec3Close(actual: readonly [number, number, number], expected: readonly [number, number, number]) {
  expect(closeTo(actual[0], expected[0])).toBe(true);
  expect(closeTo(actual[1], expected[1])).toBe(true);
  expect(closeTo(actual[2], expected[2])).toBe(true);
}
