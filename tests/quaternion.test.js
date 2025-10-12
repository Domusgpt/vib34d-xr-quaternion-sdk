import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTranslationDualQuaternion,
  normalizeDualQuaternion,
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
