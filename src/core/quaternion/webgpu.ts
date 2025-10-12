import {
  dualQuaternionFromRotationTranslation,
  IDENTITY_QUATERNION,
  writeDualQuaternionToArray,
  type DualQuaternion
} from './index.js';
import {
  poseToDualQuaternion,
  poseVectorToTuple,
  type ValidatedXRPoseFrame,
  type XRControllerPosePayload,
  type XRDeviceRole,
  type XRHandPosePayload,
  type XRHandedness,
  type XRReferenceSpace,
  type XRTrackedPosePayload
} from './poseSchema.js';

export interface QuaternionDeviceDescriptor {
  readonly role: XRDeviceRole;
  readonly handedness: XRHandedness;
}

export interface QuaternionBufferConfig {
  readonly includeControllers?: boolean;
  readonly includeHands?: boolean;
  readonly slots?: readonly QuaternionDeviceDescriptor[];
}

export interface QuaternionBufferWriteResult {
  readonly deviceMask: number;
  readonly slots: readonly QuaternionDeviceDescriptor[];
}

export interface QuaternionWgslModuleOptions {
  readonly deviceStructName?: string;
  readonly headerStructName?: string;
}

const HEADER_FLOATS = 4;
const VEC4_FLOATS = 4;
const DEVICE_VEC4S = 5;
const DEVICE_FLOATS = DEVICE_VEC4S * VEC4_FLOATS;

const DEFAULT_SLOTS: readonly QuaternionDeviceDescriptor[] = Object.freeze([
  { role: 'headset', handedness: 'none' },
  { role: 'controller', handedness: 'left' },
  { role: 'controller', handedness: 'right' }
]);

const ZERO_TRANSLATION_DUAL: DualQuaternion = dualQuaternionFromRotationTranslation(
  IDENTITY_QUATERNION,
  [0, 0, 0] as const
);

const REFERENCE_SPACE_CODES: Record<XRReferenceSpace, number> = {
  local: 0,
  'local-floor': 1,
  stage: 2,
  viewer: 3
};

const RELIABILITY_CODES = {
  tracked: 2,
  estimated: 1,
  unavailable: 0
} as const;

const RELIABILITY_CONFIDENCE = {
  tracked: 1,
  estimated: 0.6,
  unavailable: 0
} as const;

export const QUATERNION_BUFFER_HEADER_FLOATS = HEADER_FLOATS;
export const QUATERNION_DEVICE_VEC4S = DEVICE_VEC4S;
export const QUATERNION_DEVICE_FLOATS = DEVICE_FLOATS;

export function resolveQuaternionSlots(
  config?: QuaternionBufferConfig
): readonly QuaternionDeviceDescriptor[] {
  if (!config) {
    return DEFAULT_SLOTS;
  }

  if (config.slots?.length) {
    return config.slots;
  }

  const includeControllers = config.includeControllers !== false;
  const includeHands = config.includeHands === true;

  if (includeControllers && !includeHands) {
    return DEFAULT_SLOTS;
  }

  const slots: QuaternionDeviceDescriptor[] = [
    { role: 'headset', handedness: 'none' }
  ];

  if (includeControllers) {
    slots.push(
      { role: 'controller', handedness: 'left' },
      { role: 'controller', handedness: 'right' }
    );
  }

  if (includeHands) {
    slots.push(
      { role: 'hand', handedness: 'left' },
      { role: 'hand', handedness: 'right' }
    );
  }

  return slots;
}

export function getQuaternionBufferFloatLength(config?: QuaternionBufferConfig): number {
  const slots = resolveQuaternionSlots(config);
  return HEADER_FLOATS + slots.length * DEVICE_FLOATS;
}

export function createQuaternionStateBuffer(config?: QuaternionBufferConfig): Float32Array {
  return new Float32Array(getQuaternionBufferFloatLength(config));
}

export function hashPoseFrameId(frameId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < frameId.length; i += 1) {
    hash ^= frameId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function generateQuaternionWgslModule(
  options: QuaternionWgslModuleOptions = {}
): string {
  const deviceStructName = options.deviceStructName ?? 'QuaternionDeviceState';
  const headerStructName = options.headerStructName ?? 'QuaternionFrameHeader';
  return /* wgsl */ `struct ${headerStructName} {
  frame_id_hash : u32,
  frame_time : f32,
  reference_space : u32,
  device_mask : u32,
};

struct ${deviceStructName} {
  real : vec4<f32>,
  dual : vec4<f32>,
  linear_velocity : vec4<f32>,
  angular_velocity : vec4<f32>,
  metadata : vec4<f32>,
};

fn decode_device_confidence(metadata : vec4<f32>) -> f32 {
  return metadata.x;
}

fn decode_device_reliability(metadata : vec4<f32>) -> f32 {
  return metadata.y;
}

fn decode_device_accuracy(metadata : vec4<f32>) -> f32 {
  return metadata.z;
}

fn decode_device_timestamp_delta(metadata : vec4<f32>) -> f32 {
  return metadata.w;
}`;
}

export function writePoseFrameToBuffer(
  frame: ValidatedXRPoseFrame,
  target: Float32Array,
  config?: QuaternionBufferConfig
): QuaternionBufferWriteResult {
  const slots = resolveQuaternionSlots(config);
  const required = HEADER_FLOATS + slots.length * DEVICE_FLOATS;
  if (target.length < required) {
    throw new Error(
      `Quaternion state buffer requires ${required} floats but received ${target.length}`
    );
  }

  const headerF32 = new Float32Array(target.buffer, target.byteOffset, HEADER_FLOATS);
  const headerU32 = new Uint32Array(target.buffer, target.byteOffset, HEADER_FLOATS);
  headerU32[0] = hashPoseFrameId(frame.frameId);
  headerF32[1] = frame.timestamp / 1000;
  headerU32[2] = referenceSpaceToCode(frame.referenceSpace);

  const controllersByHand = indexByHandedness(frame.controllers);
  const handsByHand = indexByHandedness(frame.hands);

  let deviceMask = 0;

  slots.forEach((descriptor, index) => {
    const offset = HEADER_FLOATS + index * DEVICE_FLOATS;
    const pose = resolvePoseForSlot(frame, descriptor, controllersByHand, handsByHand);
    if (pose) {
      deviceMask |= 1 << index;
      writePoseState(frame, pose, target, offset);
    } else {
      target.fill(0, offset, offset + DEVICE_FLOATS);
      writeDualQuaternionToArray(ZERO_TRANSLATION_DUAL, target, offset);
    }
  });

  headerU32[3] = deviceMask >>> 0;

  return { deviceMask, slots };
}

function resolvePoseForSlot(
  frame: ValidatedXRPoseFrame,
  descriptor: QuaternionDeviceDescriptor,
  controllers: ReadonlyMap<XRHandedness, XRControllerPosePayload>,
  hands: ReadonlyMap<XRHandedness, XRHandPosePayload>
): XRTrackedPosePayload | null {
  if (descriptor.role === 'headset') {
    return frame.head;
  }

  if (descriptor.role === 'controller') {
    return controllers.get(descriptor.handedness) ?? null;
  }

  if (descriptor.role === 'hand') {
    return hands.get(descriptor.handedness) ?? null;
  }

  return null;
}

function indexByHandedness<T extends { handedness: XRHandedness }>(
  items: readonly T[]
): ReadonlyMap<XRHandedness, T> {
  const map = new Map<XRHandedness, T>();
  for (const item of items) {
    map.set(item.handedness, item);
  }
  return map;
}

function writePoseState(
  frame: ValidatedXRPoseFrame,
  pose: XRTrackedPosePayload,
  target: Float32Array,
  offset: number
): void {
  const dq = poseToDualQuaternion(pose);
  writeDualQuaternionToArray(dq, target, offset);

  const linearVelocity = pose.linearVelocity ? poseVectorToTuple(pose.linearVelocity) : null;
  const angularVelocity = pose.angularVelocity ? poseVectorToTuple(pose.angularVelocity) : null;

  writeVec4(
    target,
    offset + 8,
    linearVelocity?.[0] ?? 0,
    linearVelocity?.[1] ?? 0,
    linearVelocity?.[2] ?? 0,
    linearVelocity ? magnitude(linearVelocity) : 0
  );

  writeVec4(
    target,
    offset + 12,
    angularVelocity?.[0] ?? 0,
    angularVelocity?.[1] ?? 0,
    angularVelocity?.[2] ?? 0,
    angularVelocity ? magnitude(angularVelocity) : 0
  );

  const confidence = computePoseConfidence(pose);
  const reliability = RELIABILITY_CODES[pose.reliability];
  const accuracy = pose.accuracy ?? 0;
  const timestampDelta = pose.timestamp - frame.timestamp;

  writeVec4(target, offset + 16, confidence, reliability, accuracy, timestampDelta);
}

function computePoseConfidence(pose: XRTrackedPosePayload): number {
  const baseConfidence = RELIABILITY_CONFIDENCE[pose.reliability];
  const accuracyScale = pose.accuracy != null ? 1 / (1 + pose.accuracy) : 1;
  return clamp01(baseConfidence * accuracyScale);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function magnitude(vector: readonly [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function writeVec4(
  target: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number
): void {
  target[offset + 0] = x;
  target[offset + 1] = y;
  target[offset + 2] = z;
  target[offset + 3] = w;
}

function referenceSpaceToCode(space: XRReferenceSpace): number {
  const code = REFERENCE_SPACE_CODES[space];
  if (code === undefined) {
    throw new Error(`Unsupported XR reference space: ${space}`);
  }
  return code;
}
