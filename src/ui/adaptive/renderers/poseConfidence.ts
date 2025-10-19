import type {
  QuaternionDeviceState,
} from '../../../core/quaternion/registry.ts';
import type {
  XRPoseReliability,
} from '../../../core/quaternion/poseSchema.ts';
import type { Vec3 } from '../../../core/quaternion/index.ts';

export type ReliabilityConfidenceMap = Readonly<Partial<Record<XRPoseReliability, number>>>;

export const DEFAULT_RELIABILITY_CONFIDENCE: Readonly<Record<XRPoseReliability, number>> = {
  tracked: 0.95,
  estimated: 0.6,
  unavailable: 0.25,
};

export const DEFAULT_RELIABILITY_RANK: Readonly<Record<XRPoseReliability, number>> = {
  tracked: 3,
  estimated: 2,
  unavailable: 1,
};

export const DEFAULT_STALE_THRESHOLD_MS = 120;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const magnitude = (vec?: Vec3 | null): number => {
  if (!vec) {
    return 0;
  }
  return Math.hypot(vec[0] ?? 0, vec[1] ?? 0, vec[2] ?? 0);
};

const stabilityFromVelocity = (vec?: Vec3 | null): number => {
  const mag = magnitude(vec);
  if (!Number.isFinite(mag) || mag <= 0) {
    return 1;
  }
  return Math.exp(-mag);
};

const accuracyToConfidence = (accuracy?: number): number => {
  if (!Number.isFinite(accuracy)) {
    return 0.75;
  }

  if (accuracy <= 0.01) {
    return 0.98;
  }
  if (accuracy <= 0.05) {
    return 0.9;
  }
  if (accuracy <= 0.1) {
    return 0.8;
  }
  if (accuracy <= 0.2) {
    return 0.65;
  }
  if (accuracy <= 0.35) {
    return 0.5;
  }
  return 0.35;
};

export const recencyToConfidence = (deltaMs: number, staleThreshold: number): number => {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 1;
  }

  if (deltaMs <= staleThreshold) {
    return 1;
  }

  const maxDelta = staleThreshold * 4;
  if (deltaMs >= maxDelta) {
    return 0.25;
  }

  const normalized = 1 - (deltaMs - staleThreshold) / (maxDelta - staleThreshold);
  return 0.25 + 0.75 * clamp01(normalized);
};

export interface PoseConfidenceComputationOptions {
  readonly staleThresholdMs?: number;
  readonly now?: () => number;
  readonly reliabilityConfidence?: ReliabilityConfidenceMap;
}

export const computePoseConfidence = (
  device: QuaternionDeviceState,
  options: PoseConfidenceComputationOptions = {}
): number => {
  const staleThreshold = Math.max(16, Math.floor(options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS));
  const now = typeof options.now === 'function'
    ? options.now
    : (() => (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()));

  const reliabilityConfidence = {
    ...DEFAULT_RELIABILITY_CONFIDENCE,
    ...(options.reliabilityConfidence || {}),
  } as Readonly<Record<XRPoseReliability, number>>;

  const reliability = reliabilityConfidence[device.reliability] ?? 0.5;
  const accuracy = accuracyToConfidence(device.accuracy);

  const linearStability = stabilityFromVelocity(device.linearVelocity);
  const angularStability = stabilityFromVelocity(device.angularVelocity);
  const stability = clamp01((linearStability + angularStability) * 0.5);

  const timestamp = device.current.frameTimestamp ?? now();
  const recencyDelta = now() - timestamp;
  const recency = recencyToConfidence(recencyDelta, staleThreshold);

  const weighted = reliability * 0.6 + accuracy * 0.25 + stability * 0.15;
  return clamp01(weighted * recency);
};

export const createRankMap = <T extends string>(order: readonly T[]): Map<T, number> => {
  const map = new Map<T, number>();
  order.forEach((entry, index) => {
    map.set(entry, index);
  });
  return map;
};

export const clampConfidence = clamp01;

export type PoseConfidenceHeuristics = ReturnType<typeof computePoseConfidence>;
