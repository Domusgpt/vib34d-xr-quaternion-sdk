const EPSILON = 1e-12;
const QUATERNION_LENGTH = 4;

const IDENTITY_QUATERNION_ARRAY = [1, 0, 0, 0];
const IDENTITY_QUATERNION_OBJECT = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * Quaternion components are expressed in [w, x, y, z] order.
 * @typedef {[number, number, number, number]} Quaternion
 * @typedef {{ real: Quaternion, dual: Quaternion }} DualQuaternion
 * @typedef {number[] | Float32Array | Float64Array} WritableArrayLike
 * @typedef {{ x?: number | null, y?: number | null, z?: number | null, w?: number | null }} QuaternionObjectLike
 */

/**
 * @returns {Quaternion}
 */
export function identityQuaternion() {
  return [...IDENTITY_QUATERNION_ARRAY];
}

/**
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
export function identityQuaternionObject() {
  return { ...IDENTITY_QUATERNION_OBJECT };
}

/**
 * Compute the Euclidean length of a quaternion represented as a tuple.
 * @param {readonly [number, number, number, number]} quaternion
 * @returns {number}
 */
export function quaternionMagnitude(quaternion) {
  return Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

/**
 * @param {unknown} value
 * @returns {[number, number, number]}
 */
function toVector3(value) {
  if (!value) {
    return [0, 0, 0];
  }

  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [
      toFiniteNumber(value[0]),
      toFiniteNumber(value[1]),
      toFiniteNumber(value[2]),
    ];
  }

  if (typeof value === 'object') {
    return [
      toFiniteNumber(value.x),
      toFiniteNumber(value.y),
      toFiniteNumber(value.z),
    ];
  }

  return [0, 0, 0];
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
function computeComplementW(x, y, z) {
  const radicand = Math.max(0, 1 - (x * x + y * y + z * z));
  return Math.sqrt(radicand);
}

/**
 * Multiply two quaternions represented as [w, x, y, z] tuples.
 * @param {readonly [number, number, number, number]} a
 * @param {readonly [number, number, number, number]} b
 * @returns {[number, number, number, number]}
 */
function multiplyQuaternionTuples(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;

  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/**
 * Conjugate a quaternion expressed as a [w, x, y, z] tuple.
 * @param {readonly [number, number, number, number]} quaternion
 * @returns {[number, number, number, number]}
 */
function conjugateQuaternionTuple(quaternion) {
  return [
    quaternion[0],
    -quaternion[1],
    -quaternion[2],
    -quaternion[3],
  ];
}

/**
 * Normalize a quaternion represented as either a tuple or object-like shape.
 * @param {Quaternion | QuaternionObjectLike | Float32Array | Float64Array} quaternion
 * @returns {Quaternion}
 */
export function normalizeQuaternion(quaternion) {
  const components = toQuaternionComponents(quaternion);
  const length = quaternionMagnitude(components);

  if (length < EPSILON) {
    throw new Error('Cannot normalize a quaternion with near-zero magnitude.');
  }

  return components.map((value) => value / length);
}

/**
 * Normalize a quaternion-like value and return an object representation.
 * Falls back to the identity quaternion when normalization is not possible.
 * @param {Quaternion | QuaternionObjectLike | Float32Array | Float64Array | null | undefined} quaternion
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
export function normalizeQuaternionObject(quaternion) {
  try {
    const [w, x, y, z] = normalizeQuaternion(quaternion ?? identityQuaternion());
    return { x, y, z, w };
  } catch (error) {
    return identityQuaternionObject();
  }
}

/**
 * Normalize a dual quaternion by normalizing both real and dual parts once.
 * @param {DualQuaternion} dualQuaternion
 * @returns {DualQuaternion}
 */
export function normalizeDualQuaternion(dualQuaternion) {
  const realComponents = toQuaternionComponents(dualQuaternion.real);
  const length = quaternionMagnitude(realComponents);

  if (length < EPSILON) {
    throw new Error('Cannot normalize a dual quaternion with a real part of near-zero magnitude.');
  }

  const dualComponents = toQuaternionComponents(dualQuaternion.dual);
  return {
    real: realComponents.map((value) => value / length),
    dual: dualComponents.map((value) => value / length),
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

/**
 * Compose a rigid dual quaternion from orientation and translation components.
 * @param {Quaternion | QuaternionObjectLike | Float32Array | Float64Array | null | undefined} orientation
 * @param {readonly [number, number, number] | QuaternionObjectLike | Float32Array | Float64Array | null | undefined} translation
 * @returns {DualQuaternion}
 */
export function composeDualQuaternion(orientation, translation) {
  const real = normalizeQuaternion(orientation ?? identityQuaternion());
  const [tx, ty, tz] = toVector3(translation);

  const translationQuaternion = [0, tx, ty, tz];
  const dualProduct = multiplyQuaternionTuples(translationQuaternion, real);

  return {
    real,
    dual: dualProduct.map((value) => value * 0.5),
  };
}

/**
 * Derive orientation and translation from a dual quaternion.
 * @param {DualQuaternion} dualQuaternion
 * @param {{ normalized?: boolean }} [options]
 * @returns {{ orientation: { x: number, y: number, z: number, w: number }, position: [number, number, number], normalized: DualQuaternion }}
 */
export function dualQuaternionToPose(dualQuaternion, options = {}) {
  const normalized = options.normalized ? dualQuaternion : normalizeDualQuaternion(dualQuaternion);
  const { real, dual } = normalized;

  const orientation = {
    x: real[1],
    y: real[2],
    z: real[3],
    w: real[0],
  };

  const translationQuaternion = multiplyQuaternionTuples(dual, conjugateQuaternionTuple(real));
  const position = [
    2 * translationQuaternion[1],
    2 * translationQuaternion[2],
    2 * translationQuaternion[3],
  ];

  return { orientation, position, normalized };
}

/**
 * Convert a dual quaternion to a 4x4 transformation matrix.
 * @param {DualQuaternion} dualQuaternion
 * @param {{ normalized?: boolean, target?: Float32Array }} [options]
 * @returns {Float32Array}
 */
export function dualQuaternionToMatrix(dualQuaternion, options = {}) {
  const target = options.target instanceof Float32Array && options.target.length >= 16
    ? options.target
    : new Float32Array(16);

  const { orientation, position } = dualQuaternionToPose(dualQuaternion, {
    normalized: options.normalized,
  });

  const quaternion = normalizeQuaternionObject(orientation);
  const { x, y, z, w } = quaternion;

  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  target[0] = 1 - 2 * (yy + zz);
  target[1] = 2 * (xy - wz);
  target[2] = 2 * (xz + wy);
  target[3] = 0;

  target[4] = 2 * (xy + wz);
  target[5] = 1 - 2 * (xx + zz);
  target[6] = 2 * (yz - wx);
  target[7] = 0;

  target[8] = 2 * (xz - wy);
  target[9] = 2 * (yz + wx);
  target[10] = 1 - 2 * (xx + yy);
  target[11] = 0;

  target[12] = position[0];
  target[13] = position[1];
  target[14] = position[2];
  target[15] = 1;

  return target;
}

/**
 * Multiply two quaternions expressed as object-like shapes.
 * @param {Quaternion | QuaternionObjectLike} a
 * @param {Quaternion | QuaternionObjectLike} b
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
export function multiplyQuaternions(a, b) {
  const [aw, ax, ay, az] = toQuaternionComponents(a);
  const [bw, bx, by, bz] = toQuaternionComponents(b);

  return {
    w: aw * bw - ax * bx - ay * by - az * bz,
    x: aw * bx + ax * bw + ay * bz - az * by,
    y: aw * by - ax * bz + ay * bw + az * bx,
    z: aw * bz + ax * by - ay * bx + az * bw,
  };
}

/**
 * Conjugate a quaternion expressed as either tuple or object.
 * @param {Quaternion | QuaternionObjectLike} quaternion
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
export function conjugateQuaternion(quaternion) {
  const [w, x, y, z] = toQuaternionComponents(quaternion);
  return { x: -x, y: -y, z: -z, w };
}

/**
 * Convert a quaternion into Euler angles (roll, pitch, yaw).
 * @param {Quaternion | QuaternionObjectLike} quaternion
 * @returns {{ roll: number, pitch: number, yaw: number }}
 */
export function quaternionToEuler(quaternion) {
  const normalized = normalizeQuaternionObject(quaternion);
  const { x, y, z, w } = normalized;

  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr, cosr);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy);

  return { roll, pitch, yaw };
}

/**
 * @param {Quaternion | QuaternionObjectLike | Float32Array | Float64Array | null | undefined} quaternion
 * @returns {Quaternion}
 */
function toQuaternionComponents(quaternion) {
  if (quaternion == null) {
    return identityQuaternion();
  }

  if (Array.isArray(quaternion) || ArrayBuffer.isView(quaternion)) {
    const x = toFiniteNumber(quaternion[1]);
    const y = toFiniteNumber(quaternion[2]);
    const z = toFiniteNumber(quaternion[3]);
    const w = toFiniteNumber(quaternion[0], computeComplementW(x, y, z));
    return [w, x, y, z];
  }

  if (typeof quaternion === 'object') {
    const x = toFiniteNumber(quaternion.x);
    const y = toFiniteNumber(quaternion.y);
    const z = toFiniteNumber(quaternion.z);
    const w = toFiniteNumber(quaternion.w, computeComplementW(x, y, z));
    return [w, x, y, z];
  }

  return identityQuaternion();
}
