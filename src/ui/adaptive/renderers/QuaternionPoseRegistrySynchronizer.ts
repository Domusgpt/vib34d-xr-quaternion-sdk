import { normalize as normalizeQuaternion, type Quaternion } from '../../../core/quaternion/index.ts';
import type {
  QuaternionDeviceState,
  QuaternionPoseRegistry,
} from '../../../core/quaternion/registry.ts';
import type {
  XRDeviceRole,
  XRHandedness,
  XRPoseReliability,
} from '../../../core/quaternion/poseSchema.ts';

import { ShaderQuaternionSynchronizer } from './ShaderQuaternionSynchronizer.js';
import {
  clampConfidence,
  computePoseConfidence,
  createRankMap,
  DEFAULT_RELIABILITY_RANK,
  DEFAULT_STALE_THRESHOLD_MS,
} from './poseConfidence.ts';

export interface QuaternionPoseRegistrySynchronizerOptions {
  readonly registry: QuaternionPoseRegistry;
  readonly synchronizer: ShaderQuaternionSynchronizer;
  readonly preferRoles?: readonly XRDeviceRole[];
  readonly handednessPreference?: readonly XRHandedness[];
  readonly preferredDeviceIds?: readonly string[];
  readonly deviceFilter?: (device: QuaternionDeviceState) => boolean;
  readonly interpolationAlpha?: number;
  readonly updateIntervalMs?: number;
  readonly minConfidence?: number;
  readonly staleThresholdMs?: number;
  readonly autoStart?: boolean;
  readonly updateOnStart?: boolean;
  readonly timeSource?: () => number;
}

interface CandidateDevice {
  readonly device: QuaternionDeviceState;
  readonly confidence: number;
  readonly reliabilityRank: number;
  readonly roleRank: number;
  readonly handednessRank: number;
  readonly preferredRank: number;
  readonly recency: number;
}

interface SyncInfo {
  readonly deviceId: string;
  readonly role: XRDeviceRole;
  readonly confidence: number;
  readonly timestamp: number;
}

const DEFAULT_ROLE_ORDER: readonly XRDeviceRole[] = ['headset', 'controller', 'hand'];
const DEFAULT_HANDEDNESS_ORDER: readonly XRHandedness[] = ['right', 'left', 'none'];
const DEFAULT_MIN_CONFIDENCE = 0.1;
const DEFAULT_UPDATE_INTERVAL = 32;
const DEFAULT_STALE_THRESHOLD = DEFAULT_STALE_THRESHOLD_MS;

export class QuaternionPoseRegistrySynchronizer {
  private readonly registry: QuaternionPoseRegistry;
  private readonly synchronizer: ShaderQuaternionSynchronizer;
  private readonly roleRank: Map<XRDeviceRole, number>;
  private readonly handednessRank: Map<XRHandedness, number>;
  private readonly preferredRank: Map<string, number>;
  private readonly minConfidence: number;
  private readonly interpolationAlpha: number;
  private readonly staleThresholdMs: number;
  private readonly updateIntervalMs: number;
  private readonly now: () => number;
  private readonly deviceFilter?: (device: QuaternionDeviceState) => boolean;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSync: SyncInfo | null = null;

  constructor(options: QuaternionPoseRegistrySynchronizerOptions) {
    if (!options || !options.registry) {
      throw new Error('QuaternionPoseRegistrySynchronizer requires a QuaternionPoseRegistry instance');
    }
    if (!options.synchronizer) {
      throw new Error('QuaternionPoseRegistrySynchronizer requires a ShaderQuaternionSynchronizer instance');
    }

    this.registry = options.registry;
    this.synchronizer = options.synchronizer;
    this.roleRank = createRankMap(options.preferRoles ?? DEFAULT_ROLE_ORDER);
    this.handednessRank = createRankMap(options.handednessPreference ?? DEFAULT_HANDEDNESS_ORDER);
    this.preferredRank = createRankMap(options.preferredDeviceIds ?? []);
    this.minConfidence = Math.max(0, Math.min(1, options.minConfidence ?? DEFAULT_MIN_CONFIDENCE));
    this.interpolationAlpha = clampConfidence(options.interpolationAlpha ?? 1);
    this.updateIntervalMs = Math.max(4, Math.floor(options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL));
    this.staleThresholdMs = Math.max(16, Math.floor(options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD));
    this.deviceFilter = options.deviceFilter;
    this.now = typeof options.timeSource === 'function'
      ? options.timeSource
      : (() => (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()));

    if (options.autoStart) {
      this.start(options.updateOnStart !== false);
    }
  }

  start(immediate = true): this {
    this.stop();
    if (immediate) {
      this.syncOnce();
    }
    this.timer = setInterval(() => {
      this.syncOnce();
    }, this.updateIntervalMs);
    return this;
  }

  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  dispose(): void {
    this.stop();
  }

  getLastSyncInfo(): SyncInfo | null {
    return this.lastSync ? { ...this.lastSync } : null;
  }

  syncOnce(): boolean {
    const candidate = this.selectCandidate();
    if (!candidate || candidate.confidence < this.minConfidence) {
      return false;
    }

    const orientation = this.getOrientation(candidate.device);
    const timestamp = candidate.device.current.frameTimestamp ?? this.now();

    this.synchronizer.ingestQuaternion(orientation, {
      confidence: candidate.confidence,
      timestamp,
      source: `pose-registry:${candidate.device.id}`,
    });

    this.lastSync = {
      deviceId: candidate.device.id,
      role: candidate.device.role,
      confidence: candidate.confidence,
      timestamp,
    } satisfies SyncInfo;

    return true;
  }

  private selectCandidate(): CandidateDevice | null {
    const devices = this.registry.getDevices();
    if (!devices.length) {
      return null;
    }

    const candidates: CandidateDevice[] = [];
    for (const device of devices) {
      if (this.deviceFilter && !this.deviceFilter(device)) {
        continue;
      }

      const confidence = this.computeConfidence(device);
      const reliabilityRank = DEFAULT_RELIABILITY_RANK[device.reliability] ?? 0;
      const roleRank = this.roleRank.get(device.role) ?? this.roleRank.size;
      const handednessRank = this.handednessRank.get(device.handedness) ?? this.handednessRank.size;
      const preferredRank = this.preferredRank.get(device.id) ?? Number.POSITIVE_INFINITY;
      const recency = device.current.frameTimestamp ?? 0;

      candidates.push({
        device,
        confidence,
        reliabilityRank,
        roleRank,
        handednessRank,
        preferredRank,
        recency,
      });
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      if (b.reliabilityRank !== a.reliabilityRank) {
        return b.reliabilityRank - a.reliabilityRank;
      }
      if (a.preferredRank !== b.preferredRank) {
        return a.preferredRank - b.preferredRank;
      }
      if (a.roleRank !== b.roleRank) {
        return a.roleRank - b.roleRank;
      }
      if (b.recency !== a.recency) {
        return b.recency - a.recency;
      }
      if (a.handednessRank !== b.handednessRank) {
        return a.handednessRank - b.handednessRank;
      }
      return a.device.id.localeCompare(b.device.id);
    });

    return candidates[0] ?? null;
  }

  private computeConfidence(device: QuaternionDeviceState): number {
    return computePoseConfidence(device, {
      staleThresholdMs: this.staleThresholdMs,
      now: this.now,
    });
  }

  private getOrientation(device: QuaternionDeviceState): Quaternion {
    if (this.interpolationAlpha > 0 && this.interpolationAlpha < 1) {
      const dual = this.registry.getInterpolatedDualQuaternion(device.id, this.interpolationAlpha);
      if (dual) {
        return normalizeQuaternion(dual.real);
      }
    }

    return normalizeQuaternion(device.current.orientation);
  }
}

export default QuaternionPoseRegistrySynchronizer;

