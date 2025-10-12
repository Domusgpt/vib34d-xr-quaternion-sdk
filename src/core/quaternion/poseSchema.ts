import Ajv, { type ErrorObject, type JSONSchemaType } from 'ajv';

import type { DualQuaternion, Quaternion, Vec3 } from './index.js';
import { dualQuaternionFromRotationTranslation } from './index.js';

export type XRReferenceSpace = 'local' | 'local-floor' | 'stage' | 'viewer';

export type XRDeviceRole = 'headset' | 'controller' | 'hand';

export type XRHandedness = 'left' | 'right' | 'none';

export type XRPoseReliability = 'tracked' | 'estimated' | 'unavailable';

export interface XRVector3Payload {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface XRQuaternionPayload {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface XRTrackedPosePayload {
  readonly id: string;
  readonly role: XRDeviceRole;
  readonly handedness: XRHandedness;
  readonly timestamp: number;
  readonly orientation: XRQuaternionPayload;
  readonly position: XRVector3Payload;
  readonly linearVelocity?: XRVector3Payload;
  readonly angularVelocity?: XRVector3Payload;
  readonly reliability: XRPoseReliability;
  readonly accuracy?: number;
}

export interface XRControllerPosePayload extends XRTrackedPosePayload {
  readonly role: 'controller';
  readonly handedness: Exclude<XRHandedness, 'none'>;
  readonly buttons?: readonly number[];
  readonly triggers?: readonly number[];
}

export interface XRHandPosePayload extends XRTrackedPosePayload {
  readonly role: 'hand';
  readonly handedness: Exclude<XRHandedness, 'none'>;
  readonly joints?: readonly number[];
}

export interface XRHeadPosePayload extends XRTrackedPosePayload {
  readonly role: 'headset';
  readonly handedness: 'none';
}

export interface XRPoseFramePayload {
  readonly frameId: string;
  readonly timestamp: number;
  readonly referenceSpace: XRReferenceSpace;
  readonly head: XRHeadPosePayload;
  readonly controllers?: readonly XRControllerPosePayload[];
  readonly hands?: readonly XRHandPosePayload[];
  readonly metadata?: Record<string, unknown>;
}

export interface ValidatedXRPoseFrame
  extends Omit<XRPoseFramePayload, 'controllers' | 'hands'> {
  readonly controllers: readonly XRControllerPosePayload[];
  readonly hands: readonly XRHandPosePayload[];
}

function createVector3Schema(): JSONSchemaType<XRVector3Payload> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'z'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      z: { type: 'number' }
    }
  };
}

function createQuaternionSchema(): JSONSchemaType<XRQuaternionPayload> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'z', 'w'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      z: { type: 'number' },
      w: { type: 'number' }
    }
  };
}

const vector3Schema = createVector3Schema();
const quaternionSchema = createQuaternionSchema();

const trackedPoseSchema: JSONSchemaType<XRTrackedPosePayload> = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'role', 'handedness', 'timestamp', 'orientation', 'position', 'reliability'],
  properties: {
    id: { type: 'string', minLength: 1 },
    role: { enum: ['headset', 'controller', 'hand'] },
    handedness: { enum: ['left', 'right', 'none'] },
    timestamp: { type: 'number', minimum: 0 },
    orientation: quaternionSchema,
    position: vector3Schema,
    linearVelocity: createVector3Schema(),
    angularVelocity: createVector3Schema(),
    reliability: { enum: ['tracked', 'estimated', 'unavailable'] },
    accuracy: { type: 'number', minimum: 0 }
  }
};

const controllerPoseSchema: JSONSchemaType<XRControllerPosePayload> = {
  ...trackedPoseSchema,
  properties: {
    ...trackedPoseSchema.properties,
    role: { const: 'controller' },
    handedness: { enum: ['left', 'right'] },
    buttons: {
      type: 'array',
      items: { type: 'number' },
      default: []
    },
    triggers: {
      type: 'array',
      items: { type: 'number' },
      default: []
    }
  }
};

const handPoseSchema: JSONSchemaType<XRHandPosePayload> = {
  ...trackedPoseSchema,
  properties: {
    ...trackedPoseSchema.properties,
    role: { const: 'hand' },
    handedness: { enum: ['left', 'right'] },
    joints: {
      type: 'array',
      items: { type: 'number' },
      default: []
    }
  }
};

const headPoseSchema: JSONSchemaType<XRHeadPosePayload> = {
  ...trackedPoseSchema,
  properties: {
    ...trackedPoseSchema.properties,
    role: { const: 'headset' },
    handedness: { const: 'none' }
  }
};

export const XR_POSE_FRAME_SCHEMA: JSONSchemaType<XRPoseFramePayload> = {
  type: 'object',
  additionalProperties: false,
  required: ['frameId', 'timestamp', 'referenceSpace', 'head'],
  properties: {
    frameId: { type: 'string', minLength: 1 },
    timestamp: { type: 'number', minimum: 0 },
    referenceSpace: { enum: ['local', 'local-floor', 'stage', 'viewer'] },
    head: headPoseSchema,
    controllers: {
      type: 'array',
      items: controllerPoseSchema,
      default: []
    },
    hands: {
      type: 'array',
      items: handPoseSchema,
      default: []
    },
    metadata: {
      type: 'object',
      required: [],
      additionalProperties: true
    }
  }
};

const ajv = new Ajv({
  allErrors: true,
  strict: false
});

const poseValidator = ajv.compile(XR_POSE_FRAME_SCHEMA);

export class XRPoseValidationError extends Error {
  public readonly issues: ErrorObject[];

  constructor(issues: ErrorObject[]) {
    super(ajv.errorsText(issues, { separator: '\n' }));
    this.name = 'XRPoseValidationError';
    this.issues = issues;
  }
}

export function validatePoseFrame(payload: unknown): ValidatedXRPoseFrame {
  if (poseValidator(payload)) {
    return normalizePoseDefaults(payload);
  }
  throw new XRPoseValidationError(poseValidator.errors ?? []);
}

function normalizePoseDefaults(payload: XRPoseFramePayload): ValidatedXRPoseFrame {
  return {
    ...payload,
    controllers: payload.controllers ?? [],
    hands: payload.hands ?? []
  };
}

export function poseQuaternionToTuple(quaternion: XRQuaternionPayload): Quaternion {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

export function poseVectorToTuple(vector: XRVector3Payload): Vec3 {
  return [vector.x, vector.y, vector.z];
}

export function poseToDualQuaternion(pose: XRTrackedPosePayload): DualQuaternion {
  return dualQuaternionFromRotationTranslation(
    poseQuaternionToTuple(pose.orientation),
    poseVectorToTuple(pose.position)
  );
}

