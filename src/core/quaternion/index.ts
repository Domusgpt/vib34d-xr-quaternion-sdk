/**
 * Quaternion and dual-quaternion utilities shared between Web, Unity, and native runtimes.
 *
 * The goal of this module is to provide numerically stable math primitives that can be
 * tree-shaken by bundlers while also exposing string-based shader snippets that stay in
 * sync with the CPU implementations. All functions operate on plain tuples so consumers
 * can map to `Float32Array`/`Float64Array` without copying.
 */

export type Quaternion = readonly [number, number, number, number];
export type MutableQuaternion = [number, number, number, number];
export type Vec3 = readonly [number, number, number];
export type Rotor6 = {
  readonly xy: number;
  readonly xz: number;
  readonly yz: number;
  readonly xw: number;
  readonly yw: number;
  readonly zw: number;
};

export interface DualQuaternion {
  readonly real: Quaternion;
  readonly dual: Quaternion;
}

const EPSILON = 1e-6;

export const IDENTITY_QUATERNION: Quaternion = Object.freeze([0, 0, 0, 1]) as Quaternion;

export function createQuaternion(x = 0, y = 0, z = 0, w = 1): Quaternion {
  return [x, y, z, w];
}

export function cloneQuaternion(source: Quaternion): Quaternion {
  return [source[0], source[1], source[2], source[3]];
}

export function dot(a: Quaternion, b: Quaternion): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function magnitude(q: Quaternion): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

export function normalize(q: Quaternion): Quaternion {
  const mag = magnitude(q);
  if (mag < EPSILON) {
    return IDENTITY_QUATERNION;
  }
  const inv = 1 / mag;
  return [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv];
}

export function conjugate(q: Quaternion): Quaternion {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];

  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];

  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

export function inverse(q: Quaternion): Quaternion {
  const conj = conjugate(q);
  const magSq = dot(q, q);
  if (magSq < EPSILON) {
    return IDENTITY_QUATERNION;
  }
  const inv = 1 / magSq;
  return [conj[0] * inv, conj[1] * inv, conj[2] * inv, conj[3] * inv];
}

export function lerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  const result: MutableQuaternion = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t
  ];
  return normalize(result);
}

export function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let cosTheta = dot(a, b);
  let bAdjusted = b;

  if (cosTheta < 0) {
    cosTheta = -cosTheta;
    bAdjusted = [-b[0], -b[1], -b[2], -b[3]];
  }

  if (cosTheta > 1 - EPSILON) {
    return lerp(a, bAdjusted, t);
  }

  const angle = Math.acos(Math.min(Math.max(cosTheta, -1), 1));
  const sinAngle = Math.sin(angle);
  const weightA = Math.sin((1 - t) * angle) / sinAngle;
  const weightB = Math.sin(t * angle) / sinAngle;

  return [
    a[0] * weightA + bAdjusted[0] * weightB,
    a[1] * weightA + bAdjusted[1] * weightB,
    a[2] * weightA + bAdjusted[2] * weightB,
    a[3] * weightA + bAdjusted[3] * weightB
  ];
}

export function fromAxisAngle(axis: Vec3, angle: number): Quaternion {
  const halfAngle = angle * 0.5;
  const sin = Math.sin(halfAngle);
  const cos = Math.cos(halfAngle);
  const mag = Math.hypot(axis[0], axis[1], axis[2]);
  if (mag < EPSILON) {
    return IDENTITY_QUATERNION;
  }
  const invMag = 1 / mag;
  return [axis[0] * invMag * sin, axis[1] * invMag * sin, axis[2] * invMag * sin, cos];
}

export function toAxisAngle(q: Quaternion): { axis: Vec3; angle: number } {
  const normalized = normalize(q);
  const angle = 2 * Math.acos(Math.min(Math.max(normalized[3], -1), 1));
  const sinHalf = Math.sin(angle / 2);

  if (sinHalf < EPSILON) {
    return { axis: [1, 0, 0], angle: 0 };
  }

  const inv = 1 / sinHalf;
  return {
    axis: [normalized[0] * inv, normalized[1] * inv, normalized[2] * inv],
    angle
  };
}

export function quaternionToMatrix4(q: Quaternion): number[] {
  const [x, y, z, w] = normalize(q);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    0,
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    0,
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
    0,
    0,
    0,
    0,
    1
  ];
}

export function quaternionToMatrix3(q: Quaternion): number[] {
  const m4 = quaternionToMatrix4(q);
  return [m4[0], m4[1], m4[2], m4[4], m4[5], m4[6], m4[8], m4[9], m4[10]];
}

export type EulerAngles = [number, number, number];

export function quaternionToEuler(q: Quaternion): EulerAngles {
  const [x, y, z, w] = normalize(q);

  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  let pitch: number;
  if (Math.abs(sinp) >= 1) {
    pitch = Math.sign(sinp) * Math.PI * 0.5;
  } else {
    pitch = Math.asin(sinp);
  }

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return [roll, pitch, yaw];
}

export function quaternionTo4DRotationAngles(q: Quaternion, scale = 0.5): [number, number, number] {
  const [roll, pitch, yaw] = quaternionToEuler(q);
  return [roll * scale, pitch * scale, yaw * scale];
}

export interface QuaternionRotorSnapshot {
  readonly matrix4: number[];
  readonly euler: EulerAngles;
  readonly rotor4d: [number, number, number];
}

export function deriveRotorSnapshot(q: Quaternion): QuaternionRotorSnapshot {
  const normalized = normalize(q);
  return {
    matrix4: quaternionToMatrix4(normalized),
    euler: quaternionToEuler(normalized),
    rotor4d: quaternionTo4DRotationAngles(normalized)
  };
}

export function matrix3ToQuaternion(matrix: readonly number[]): Quaternion {
  if (matrix.length !== 9) {
    throw new Error('Matrix3 requires 9 components.');
  }

  const m00 = matrix[0];
  const m01 = matrix[1];
  const m02 = matrix[2];
  const m10 = matrix[3];
  const m11 = matrix[4];
  const m12 = matrix[5];
  const m20 = matrix[6];
  const m21 = matrix[7];
  const m22 = matrix[8];

  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  return normalize([-x, -y, -z, w]);
}

export function matrix4ToQuaternion(matrix: readonly number[]): Quaternion {
  if (matrix.length !== 16) {
    throw new Error('Matrix4 requires 16 components.');
  }

  return matrix3ToQuaternion([
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[8],
    matrix[9],
    matrix[10]
  ]);
}

export function matrix4ToTranslation(matrix: readonly number[]): Vec3 {
  if (matrix.length !== 16) {
    throw new Error('Matrix4 requires 16 components.');
  }

  return [matrix[12], matrix[13], matrix[14]];
}

export function quaternionToUniformArray(q: Quaternion): Float32Array {
  const arr = new Float32Array(4);
  arr.set(normalize(q));
  return arr;
}

export function dualQuaternionFromRotationTranslation(
  rotation: Quaternion,
  translation: Vec3
): DualQuaternion {
  const real = normalize(rotation);
  const translationQuat: Quaternion = [translation[0], translation[1], translation[2], 0];
  const dual = scaleQuaternion(multiply(translationQuat, real), 0.5);
  return normalizeDualQuaternion({ real, dual });
}

export function dualQuaternionFromMatrix4(matrix: readonly number[]): DualQuaternion {
  if (matrix.length !== 16) {
    throw new Error('Matrix4 requires 16 components.');
  }

  const rotation = matrix4ToQuaternion(matrix);
  const translation = matrix4ToTranslation(matrix);
  return dualQuaternionFromRotationTranslation(rotation, translation);
}

export function dualQuaternionMultiply(a: DualQuaternion, b: DualQuaternion): DualQuaternion {
  const real = multiply(a.real, b.real);
  const dual = addQuaternion(multiply(a.real, b.dual), multiply(a.dual, b.real));
  return normalizeDualQuaternion({ real, dual });
}

export function dualQuaternionLerp(a: DualQuaternion, b: DualQuaternion, t: number): DualQuaternion {
  const real = slerp(a.real, b.real, t);
  const dual = lerp(a.dual, b.dual, t);
  return normalizeDualQuaternion({ real, dual });
}

export function normalizeDualQuaternion(value: DualQuaternion): DualQuaternion {
  const real = normalize(value.real);
  const dotRealDual = dot(real, value.dual);
  const dual = [
    value.dual[0] - real[0] * dotRealDual,
    value.dual[1] - real[1] * dotRealDual,
    value.dual[2] - real[2] * dotRealDual,
    value.dual[3] - real[3] * dotRealDual
  ] as MutableQuaternion;
  return { real, dual };
}

export function dualQuaternionToMatrix4(dq: DualQuaternion): number[] {
  const matrix = quaternionToMatrix4(dq.real);
  const translation = extractTranslation(dq);
  matrix[12] = translation[0];
  matrix[13] = translation[1];
  matrix[14] = translation[2];
  return matrix;
}

export function extractTranslation(dq: DualQuaternion): Vec3 {
  const realConj = conjugate(dq.real);
  const tQuat = multiply(scaleQuaternion(dq.dual, 2), realConj);
  return [tQuat[0], tQuat[1], tQuat[2]];
}

export function composeRotorFromDualQuaternion(dq: DualQuaternion): Rotor6 {
  const { axis, angle } = toAxisAngle(dq.real);
  const translation = extractTranslation(dq);

  // Map 3D axis-angle rotation into bivector weights for the XY/XZ/YZ planes.
  const xy = axis[2] * angle;
  const xz = -axis[1] * angle;
  const yz = axis[0] * angle;

  // Translation components drive the W-coupled planes, matching the existing
  // projection strategy where translational motion pushes into XW/YW/ZW rotations.
  const xw = translation[0];
  const yw = translation[1];
  const zw = translation[2];

  return { xy, xz, yz, xw, yw, zw };
}

export function rotorToDualQuaternion(rotor: Rotor6): DualQuaternion {
  const rotationMagnitude = Math.hypot(rotor.xy, rotor.xz, rotor.yz);
  const translation: Vec3 = [rotor.xw, rotor.yw, rotor.zw];

  if (rotationMagnitude < EPSILON) {
    return dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, translation);
  }

  const axis: Vec3 = [
    rotor.yz / rotationMagnitude,
    -rotor.xz / rotationMagnitude,
    rotor.xy / rotationMagnitude
  ];

  const rotation = fromAxisAngle(axis, rotationMagnitude);
  return dualQuaternionFromRotationTranslation(rotation, translation);
}

export function composeQuaternionUniformBlock(dq: DualQuaternion): Float32Array {
  const block = new Float32Array(8);
  block.set(normalize(dq.real), 0);
  block.set(normalize(dq.dual), 4);
  return block;
}

export function blendDualQuaternionArray(
  dualQuaternions: readonly DualQuaternion[],
  weights: readonly number[]
): DualQuaternion {
  if (dualQuaternions.length !== weights.length || dualQuaternions.length === 0) {
    throw new Error('Dual quaternion blend requires matching non-empty arrays.');
  }

  let accumReal: MutableQuaternion = [0, 0, 0, 0];
  let accumDual: MutableQuaternion = [0, 0, 0, 0];

  for (let i = 0; i < dualQuaternions.length; i += 1) {
    const dq = dualQuaternions[i];
    const weight = weights[i];
    accumReal = addQuaternion(accumReal, scaleQuaternion(dq.real, weight));
    accumDual = addQuaternion(accumDual, scaleQuaternion(dq.dual, weight));
  }

  return normalizeDualQuaternion({ real: accumReal, dual: accumDual });
}

export function packRotorToVec4Pairs(rotor: Rotor6): Float32Array {
  const data = new Float32Array(8);
  data[0] = rotor.xy;
  data[1] = rotor.xz;
  data[2] = rotor.yz;
  data[3] = 0;
  data[4] = rotor.xw;
  data[5] = rotor.yw;
  data[6] = rotor.zw;
  data[7] = 0;
  return data;
}

export const wgslQuaternionLibrary = /* wgsl */ `
struct DualQuaternion {
  real : vec4<f32>,
  dual : vec4<f32>,
};

fn quat_conjugate(q : vec4<f32>) -> vec4<f32> {
  return vec4<f32>(-q.xyz, q.w);
}

fn quat_to_mat4(q : vec4<f32>) -> mat4x4<f32> {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;
  let xx = x * x;
  let yy = y * y;
  let zz = z * z;
  let xy = x * y;
  let xz = x * z;
  let yz = y * z;
  let wx = w * x;
  let wy = w * y;
  let wz = w * z;
  return mat4x4<f32>(
    vec4<f32>(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy), 0.0),
    vec4<f32>(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx), 0.0),
    vec4<f32>(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy), 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

fn dq_normalize(dq : DualQuaternion) -> DualQuaternion {
  let realNorm = normalize(dq.real);
  let dualDot = dot(realNorm, dq.dual);
  return DualQuaternion(
    realNorm,
    dq.dual - realNorm * dualDot
  );
}

fn dq_to_matrix(dq : DualQuaternion) -> mat4x4<f32> {
  let r = dq.real;
  let t = dq.dual * 2.0 * quat_conjugate(r);
  let m = quat_to_mat4(r);
  return mat4x4<f32>(
    m[0],
    m[1],
    m[2],
    vec4<f32>(t.xyz, 1.0)
  );
}
`;

export const glslQuaternionLibrary = /* glsl */ `
struct DualQuaternion {
  vec4 real;
  vec4 dual;
};

vec4 quat_conjugate(vec4 q) {
  return vec4(-q.xyz, q.w);
}

mat3 quat_to_mat3(vec4 q) {
  float x = q.x;
  float y = q.y;
  float z = q.z;
  float w = q.w;
  float xx = x * x;
  float yy = y * y;
  float zz = z * z;
  float xy = x * y;
  float xz = x * z;
  float yz = y * z;
  float wx = w * x;
  float wy = w * y;
  float wz = w * z;
  return mat3(
    1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy),
    2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx),
    2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy)
  );
}

DualQuaternion dq_normalize(DualQuaternion dq) {
  vec4 realNorm = normalize(dq.real);
  float dualDot = dot(realNorm, dq.dual);
  return DualQuaternion(realNorm, dq.dual - realNorm * dualDot);
}

mat4 dq_to_matrix(DualQuaternion dq) {
  vec4 t = dq.dual * 2.0 * quat_conjugate(dq.real);
  mat3 r = quat_to_mat3(dq.real);
  return mat4(
    vec4(r[0], 0.0),
    vec4(r[1], 0.0),
    vec4(r[2], 0.0),
    vec4(t.xyz, 1.0)
  );
}
`;

function scaleQuaternion(q: Quaternion, scale: number): Quaternion {
  return [q[0] * scale, q[1] * scale, q[2] * scale, q[3] * scale];
}

function addQuaternion(a: Quaternion, b: Quaternion): MutableQuaternion {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}
