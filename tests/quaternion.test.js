import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTranslationDualQuaternion,
  conjugateQuaternion,
  identityQuaternion,
  normalizeDualQuaternion,
  normalizeQuaternion,
  normalizeQuaternionObject,
  multiplyQuaternions,
  quaternionToEuler,
  quaternionToMatrix4,
  slerpQuaternions,
  writeDualQuaternionToArray,
} from '../src/core/quaternion/index.js';

test('normalizes the dual quaternion once when writing to a buffer', () => {
  const dualQuaternion = {
    real: [2, 0, 0, 0],
    dual: [0, 3, 0, 0],
  };

  const buffer = new Float32Array(8);
  writeDualQuaternionToArray(dualQuaternion, buffer);

  const normalized = normalizeDualQuaternion(dualQuaternion);

  assert.deepEqual(Array.from(buffer), [
    normalized.real[0],
    normalized.real[1],
    normalized.real[2],
    normalized.real[3],
    normalized.dual[0],
    normalized.dual[1],
    normalized.dual[2],
    normalized.dual[3],
  ]);
});

test('normalizes quaternion typed arrays using wxyz ordering', () => {
  const normalized = normalizeQuaternion(new Float32Array([2, 0, 0, 0]));

  assert.deepEqual(normalized, [1, 0, 0, 0]);
});

test('normalizes quaternion objects and infers missing scalar components', () => {
  const normalized = normalizeQuaternionObject({ x: 0.6, y: 0.8, z: 0 });

  assert.ok(Math.abs(normalized.x - 0.6) < 1e-12);
  assert.ok(Math.abs(normalized.y - 0.8) < 1e-12);
  assert.ok(Math.abs(normalized.z) < 1e-12);
  assert.ok(Math.abs(normalized.w) < 1e-12);
});

test('multiplies quaternions using the shared core helpers', () => {
  const halfAngle = Math.PI / 6;
  const rotation = {
    w: Math.cos(halfAngle),
    x: Math.sin(halfAngle),
    y: 0,
    z: 0,
  };

  const identity = multiplyQuaternions(rotation, conjugateQuaternion(rotation));

  const reference = identityQuaternion();
  assert.ok(Math.abs(identity.w - reference[0]) < 1e-12);
  assert.ok(Math.abs(identity.x - reference[1]) < 1e-12);
  assert.ok(Math.abs(identity.y - reference[2]) < 1e-12);
  assert.ok(Math.abs(identity.z - reference[3]) < 1e-12);
});

test('derives Euler angles from shared quaternion helpers', () => {
  const rotation = {
    w: Math.cos(Math.PI / 4),
    x: 0,
    y: 0,
    z: Math.sin(Math.PI / 4),
  };

  const { roll, pitch, yaw } = quaternionToEuler(rotation);

  assert.ok(Math.abs(roll) < 1e-12);
  assert.ok(Math.abs(pitch) < 1e-12);
  assert.ok(Math.abs(yaw - (Math.PI / 2)) < 1e-12);
});

test('produces a 4x4 matrix from a quaternion using a provided buffer', () => {
  const target = new Float32Array(16).fill(NaN);
  const matrix = quaternionToMatrix4({ x: 0, y: 0, z: 0, w: 1 }, target);

  assert.equal(matrix, target);
  assert.deepEqual(Array.from(matrix), [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
});

test('slerpQuaternions interpolates smoothly between orientations', () => {
  const identity = { w: 1, x: 0, y: 0, z: 0 };
  const halfTurn = { w: 0, x: 1, y: 0, z: 0 };

  const halfway = slerpQuaternions(identity, halfTurn, 0.5);

  assert.ok(Math.abs(halfway.w - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(halfway.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(halfway.y) < 1e-12);
  assert.ok(Math.abs(halfway.z) < 1e-12);
});

test('writes a pure translation dual quaternion without altering translation magnitude', () => {
  const translation = [4, -2, 10];
  const dualQuaternion = createTranslationDualQuaternion(translation);
  const buffer = new Float32Array(8);

  writeDualQuaternionToArray(dualQuaternion, buffer);

  const expectedTranslationMagnitude = Math.hypot(...translation);
  const writtenTranslation = [buffer[5] * 2, buffer[6] * 2, buffer[7] * 2];

  assert.equal(buffer[0], 1);
  assert.equal(buffer[1], 0);
  assert.equal(buffer[2], 0);
  assert.equal(buffer[3], 0);

  assert.deepEqual(writtenTranslation, translation);
  assert.equal(Math.hypot(...writtenTranslation), expectedTranslationMagnitude);
});
