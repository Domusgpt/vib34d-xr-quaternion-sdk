import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTranslationDualQuaternion,
  composeDualQuaternion,
  conjugateQuaternion,
  dualQuaternionToMatrix,
  dualQuaternionToPose,
  identityQuaternion,
  normalizeDualQuaternion,
  normalizeQuaternion,
  normalizeQuaternionObject,
  multiplyQuaternions,
  quaternionToEuler,
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

test('composes and decomposes rigid dual quaternions with translation recovery', () => {
  const angle = Math.PI / 3;
  const orientation = { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
  const translation = [2.5, -1.75, 0.5];

  const dual = composeDualQuaternion(orientation, translation);
  const magnitude = Math.hypot(...dual.real);
  assert.ok(Math.abs(magnitude - 1) < 1e-12);

  const pose = dualQuaternionToPose(dual);
  const normalizedOrientation = normalizeQuaternionObject(orientation);

  assert.ok(Math.abs(pose.orientation.x - normalizedOrientation.x) < 1e-12);
  assert.ok(Math.abs(pose.orientation.y - normalizedOrientation.y) < 1e-12);
  assert.ok(Math.abs(pose.orientation.z - normalizedOrientation.z) < 1e-12);
  assert.ok(Math.abs(pose.orientation.w - normalizedOrientation.w) < 1e-12);

  pose.position.forEach((value, index) => {
    assert.ok(Math.abs(value - translation[index]) < 1e-12);
  });
});

test('dualQuaternionToMatrix encodes rotation and translation components', () => {
  const angle = Math.PI / 4;
  const orientation = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
  const translation = [1, 2, 3];
  const dual = composeDualQuaternion(orientation, translation);

  const matrix = dualQuaternionToMatrix(dual);
  assert.equal(matrix.length, 16);

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const tolerance = 1e-6;
  assert.ok(Math.abs(matrix[0] - cos) < tolerance);
  assert.ok(Math.abs(matrix[1] + sin) < tolerance);
  assert.ok(Math.abs(matrix[4] - sin) < tolerance);
  assert.ok(Math.abs(matrix[5] - cos) < tolerance);

  assert.ok(Math.abs(matrix[12] - translation[0]) < tolerance);
  assert.ok(Math.abs(matrix[13] - translation[1]) < tolerance);
  assert.ok(Math.abs(matrix[14] - translation[2]) < tolerance);
});
