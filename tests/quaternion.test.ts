import { describe, expect, it } from 'vitest';

import {
  IDENTITY_QUATERNION,
  blendDualQuaternionArray,
  composeRotorFromDualQuaternion,
  createQuaternion,
  dualQuaternionFromRotationTranslation,
  dualQuaternionFromMatrix4,
  dualQuaternionToMatrix4,
  extractTranslation,
  fromAxisAngle,
  matrix3ToQuaternion,
  matrix4ToQuaternion,
  matrix4ToTranslation,
  multiply,
  normalize,
  quaternionToMatrix3,
  quaternionToMatrix4,
  quaternionToUniformArray,
  rotorToDualQuaternion,
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

  it('round-trips quaternions through matrix conversions', () => {
    const source = fromAxisAngle([0.25, 0.5, 0.75], Math.PI * 0.33);
    const matrix = quaternionToMatrix3(source);
    const recovered = matrix3ToQuaternion(matrix);
    const matrixRecovered = quaternionToMatrix3(recovered);
    expectMatrix3Close(matrixRecovered, matrix);

    const matrix4 = quaternionToMatrix4(source);
    const recovered4 = matrix4ToQuaternion(matrix4);
    expectMatrix3Close(quaternionToMatrix3(recovered4), quaternionToMatrix3(source));
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

  it('constructs dual quaternions from 4x4 matrices', () => {
    const rotation = fromAxisAngle([0, 0, 1], Math.PI / 4);
    const translation: [number, number, number] = [2, -1, 0.5];
    const matrix = quaternionToMatrix4(rotation);
    matrix[12] = translation[0];
    matrix[13] = translation[1];
    matrix[14] = translation[2];

    const dq = dualQuaternionFromMatrix4(matrix);
    expectQuaternionClose(dq.real, rotation);
    expectVec3Close(extractTranslation(dq), translation);
    expectVec3Close(matrix4ToTranslation(matrix), translation);
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

  it('converts between dual quaternions and rotor representations', () => {
    const rotation = fromAxisAngle([0.3, 0.9, -0.2], Math.PI / 3);
    const dq = dualQuaternionFromRotationTranslation(rotation, [0.5, -1.2, 2.3]);
    const rotor = composeRotorFromDualQuaternion(dq);
    const reconstructed = rotorToDualQuaternion(rotor);
    expectQuaternionClose(reconstructed.real, dq.real);
    expectVec3Close(extractTranslation(reconstructed), extractTranslation(dq));
  });
});

function closeTo(value: number, expected: number, epsilon = 1e-3): boolean {
  return Math.abs(value - expected) < epsilon;
}

function expectQuaternionClose(
  actual: readonly [number, number, number, number],
  expected: readonly [number, number, number, number]
) {
  const dot =
    actual[0] * expected[0] +
    actual[1] * expected[1] +
    actual[2] * expected[2] +
    actual[3] * expected[3];

  expect(Math.abs(dot)).toBeGreaterThan(1 - 1e-3);
}

function expectVec3Close(actual: readonly [number, number, number], expected: readonly [number, number, number]) {
  expect(closeTo(actual[0], expected[0])).toBe(true);
  expect(closeTo(actual[1], expected[1])).toBe(true);
  expect(closeTo(actual[2], expected[2])).toBe(true);
}

function expectMatrix3Close(actual: readonly number[], expected: readonly number[]) {
  for (let i = 0; i < 9; i += 1) {
    expect(closeTo(actual[i], expected[i])).toBe(true);
  }
}
