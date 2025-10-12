const EPSILON = 1e-12;
const QUATERNION_LENGTH = 4;

/**
 * @typedef {[number, number, number, number]} Quaternion
 * @typedef {{ real: Quaternion, dual: Quaternion }} DualQuaternion
 * @typedef {number[] | Float32Array | Float64Array} WritableArrayLike
 */

/**
 * Compute the Euclidean length of a quaternion.
 * @param {Quaternion} quaternion
 * @returns {number}
 */
function magnitude(quaternion) {
  return Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
}

/**
 * Normalize a quaternion represented as an array of four components.
 * @param {Quaternion} quaternion
 * @returns {Quaternion}
 */
export function normalizeQuaternion(quaternion) {
  const length = magnitude(quaternion);

  if (length < EPSILON) {
    throw new Error('Cannot normalize a quaternion with near-zero magnitude.');
  }

  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ];
}

/**
 * Normalize a dual quaternion by normalizing both real and dual parts once.
 * @param {DualQuaternion} dualQuaternion
 * @returns {DualQuaternion}
 */
export function normalizeDualQuaternion(dualQuaternion) {
  const length = magnitude(dualQuaternion.real);

  if (length < EPSILON) {
    throw new Error('Cannot normalize a dual quaternion with a real part of near-zero magnitude.');
  }

  return {
    real: [
      dualQuaternion.real[0] / length,
      dualQuaternion.real[1] / length,
      dualQuaternion.real[2] / length,
      dualQuaternion.real[3] / length,
    ],
    dual: [
      dualQuaternion.dual[0] / length,
      dualQuaternion.dual[1] / length,
      dualQuaternion.dual[2] / length,
      dualQuaternion.dual[3] / length,
    ],
  };
}

/**
 * Write a dual quaternion into a buffer after a single normalization pass.
 * @param {DualQuaternion} dualQuaternion
 * @param {WritableArrayLike} buffer
 * @param {number} [offset=0]
 * @returns {WritableArrayLike}
 */
export function writeDualQuaternionToArray(dualQuaternion, buffer, offset = 0) {
  const normalized = normalizeDualQuaternion(dualQuaternion);

  for (let index = 0; index < QUATERNION_LENGTH; index += 1) {
    buffer[offset + index] = normalized.real[index];
    buffer[offset + QUATERNION_LENGTH + index] = normalized.dual[index];
  }

  return buffer;
}

/**
 * Create a dual quaternion representing a pure translation.
 * @param {readonly [number, number, number] | Float32Array | Float64Array} translation
 * @returns {DualQuaternion}
 */
export function createTranslationDualQuaternion(translation) {
  const x = Number(translation[0]) || 0;
  const y = Number(translation[1]) || 0;
  const z = Number(translation[2]) || 0;

  return {
    real: [1, 0, 0, 0],
    dual: [0, x / 2, y / 2, z / 2],
  };
}
