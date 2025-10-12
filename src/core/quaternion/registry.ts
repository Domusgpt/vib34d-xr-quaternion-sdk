import {
  poseQuaternionToTuple,
  poseToDualQuaternion,
  poseVectorToTuple,
  validatePoseFrame,
  type ValidatedXRPoseFrame,
  type XRControllerPosePayload,
  type XRDeviceRole,
  type XRHandPosePayload,
  type XRHandedness,
  type XRHeadPosePayload,
  type XRPoseFramePayload,
  type XRPoseReliability,
  type XRTrackedPosePayload
} from './poseSchema.ts';
import {
  composeRotorFromDualQuaternion,
  dualQuaternionLerp,
  normalize,
  type DualQuaternion,
  type Quaternion,
  type Rotor6,
  type Vec3
} from './index.js';

export interface PoseSample {
  readonly poseTimestamp: number;
  readonly frameTimestamp: number;
  readonly orientation: Quaternion;
  readonly position: Vec3;
  readonly dualQuaternion: DualQuaternion;
}

interface PoseDeviceStateBase {
  readonly id: string;
  readonly role: XRDeviceRole;
  readonly handedness: XRHandedness;
  readonly reliability: XRPoseReliability;
  readonly accuracy?: number;
  readonly linearVelocity?: Vec3;
  readonly angularVelocity?: Vec3;
  readonly metadata?: Record<string, unknown>;
  readonly lastUpdated: number;
  readonly current: PoseSample;
  readonly previous?: PoseSample;
}

interface HeadDeviceState extends PoseDeviceStateBase {
  readonly role: 'headset';
  readonly handedness: 'none';
}

interface ControllerDeviceState extends PoseDeviceStateBase {
  readonly role: 'controller';
  readonly handedness: Exclude<XRHandedness, 'none'>;
  readonly buttons: readonly number[];
  readonly triggers: readonly number[];
}

interface HandDeviceState extends PoseDeviceStateBase {
  readonly role: 'hand';
  readonly handedness: Exclude<XRHandedness, 'none'>;
  readonly joints: readonly number[];
}

export type QuaternionDeviceState =
  | HeadDeviceState
  | ControllerDeviceState
  | HandDeviceState;

export interface QuaternionPoseRegistryOptions {
  readonly retentionMs?: number;
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export class QuaternionPoseRegistry {
  private readonly retentionMs: number;

  private readonly devices = new Map<string, QuaternionDeviceState>();

  private latestFrame: ValidatedXRPoseFrame | null = null;

  constructor(options: QuaternionPoseRegistryOptions = {}) {
    this.retentionMs = options.retentionMs ?? 250;
  }

  get size(): number {
    return this.devices.size;
  }

  getLatestFrame(): ValidatedXRPoseFrame | null {
    return this.latestFrame;
  }

  ingestFrame(payload: XRPoseFramePayload | unknown): ValidatedXRPoseFrame {
    const frame = validatePoseFrame(payload);
    this.latestFrame = frame;

    this.processPose(frame.head, frame);
    frame.controllers.forEach(controller => this.processPose(controller, frame));
    frame.hands.forEach(hand => this.processPose(hand, frame));

    this.prune(frame.timestamp);

    return frame;
  }

  getDevice(id: string): QuaternionDeviceState | null {
    return this.devices.get(id) ?? null;
  }

  getDevices(): readonly QuaternionDeviceState[] {
    return Array.from(this.devices.values());
  }

  getDevicesByRole(role: XRDeviceRole): readonly QuaternionDeviceState[] {
    return this.getDevices().filter(device => device.role === role);
  }

  getInterpolatedDualQuaternion(id: string, alpha = 1): DualQuaternion | null {
    const state = this.devices.get(id);
    if (!state) {
      return null;
    }

    const t = clampAlpha(alpha);
    if (!state.previous || t === 1) {
      return state.current.dualQuaternion;
    }

    if (t === 0) {
      return state.previous.dualQuaternion;
    }

    return dualQuaternionLerp(state.previous.dualQuaternion, state.current.dualQuaternion, t);
  }

  getInterpolatedRotor(id: string, alpha = 1): Rotor6 | null {
    const dq = this.getInterpolatedDualQuaternion(id, alpha);
    return dq ? composeRotorFromDualQuaternion(dq) : null;
  }

  prune(referenceTimestamp: number = this.latestFrame?.timestamp ?? Date.now()): void {
    if (!Number.isFinite(this.retentionMs)) {
      return;
    }

    for (const [id, state] of this.devices) {
      if (referenceTimestamp - state.current.frameTimestamp > this.retentionMs) {
        this.devices.delete(id);
      }
    }
  }

  clear(): void {
    this.devices.clear();
    this.latestFrame = null;
  }

  private processPose(
    pose: XRTrackedPosePayload | XRControllerPosePayload | XRHandPosePayload | XRHeadPosePayload,
    frame: ValidatedXRPoseFrame
  ): void {
    const existing = this.devices.get(pose.id);
    const sample = this.createSample(pose, frame.timestamp);

    const base: PoseDeviceStateBase = {
      id: pose.id,
      role: pose.role,
      handedness: pose.handedness,
      reliability: pose.reliability,
      accuracy: pose.accuracy,
      linearVelocity: pose.linearVelocity ? poseVectorToTuple(pose.linearVelocity) : undefined,
      angularVelocity: pose.angularVelocity ? poseVectorToTuple(pose.angularVelocity) : undefined,
      metadata: frame.metadata,
      lastUpdated: frame.timestamp,
      current: sample,
      previous: existing?.current
    };

    if (pose.role === 'controller') {
      const controller: ControllerDeviceState = {
        ...base,
        role: 'controller',
        handedness: pose.handedness,
        buttons: pose.buttons ?? [],
        triggers: pose.triggers ?? []
      };
      this.devices.set(pose.id, controller);
      return;
    }

    if (pose.role === 'hand') {
      const hand: HandDeviceState = {
        ...base,
        role: 'hand',
        handedness: pose.handedness,
        joints: pose.joints ?? []
      };
      this.devices.set(pose.id, hand);
      return;
    }

    const head: HeadDeviceState = {
      ...base,
      role: 'headset',
      handedness: 'none'
    };
    this.devices.set(pose.id, head);
  }

  private createSample(pose: XRTrackedPosePayload, frameTimestamp: number): PoseSample {
    const orientation = normalize(poseQuaternionToTuple(pose.orientation));
    const position = poseVectorToTuple(pose.position);
    const dualQuaternion = poseToDualQuaternion(pose);

    return {
      poseTimestamp: pose.timestamp,
      frameTimestamp,
      orientation,
      position,
      dualQuaternion
    };
  }
}
