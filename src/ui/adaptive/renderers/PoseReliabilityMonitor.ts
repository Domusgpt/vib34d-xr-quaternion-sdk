import type {
  QuaternionDeviceState,
  QuaternionPoseRegistry,
} from '../../../core/quaternion/registry.ts';
import type {
  XRDeviceRole,
  XRHandedness,
  XRPoseReliability,
} from '../../../core/quaternion/poseSchema.ts';

import {
  computePoseConfidence,
  DEFAULT_STALE_THRESHOLD_MS,
} from './poseConfidence.ts';

interface TelemetryLike {
  track(event: string, payload?: Record<string, unknown>, meta?: Record<string, unknown>): unknown;
}

export type PoseReliabilityStatus = 'healthy' | 'degraded' | 'stale' | 'lost';

export interface PoseReliabilitySnapshot {
  readonly deviceId: string;
  readonly role: XRDeviceRole;
  readonly handedness: XRHandedness;
  readonly reliability: XRPoseReliability;
  readonly status: PoseReliabilityStatus;
  readonly confidence: number;
  readonly timestamp: number;
  readonly recencyMs: number;
}

export interface PoseReliabilityMonitorOptions {
  readonly registry: QuaternionPoseRegistry;
  readonly telemetry: TelemetryLike;
  readonly updateIntervalMs?: number;
  readonly staleThresholdMs?: number;
  readonly degradedConfidenceThreshold?: number;
  readonly recoveredConfidenceThreshold?: number;
  readonly deviceFilter?: (device: QuaternionDeviceState) => boolean;
  readonly roleFilter?: readonly XRDeviceRole[];
  readonly includeRecoveredEvents?: boolean;
  readonly now?: () => number;
  readonly autoStart?: boolean;
  readonly onStateChange?: (snapshot: PoseReliabilitySnapshot) => void;
}

const DEFAULT_DEGRADED_THRESHOLD = 0.55;
const DEFAULT_RECOVERED_THRESHOLD = 0.65;
const DEFAULT_UPDATE_INTERVAL_MS = 48;

export class PoseReliabilityMonitor {
  private readonly registry: QuaternionPoseRegistry;
  private readonly telemetry: TelemetryLike;
  private readonly updateIntervalMs: number;
  private readonly staleThresholdMs: number;
  private readonly degradedThreshold: number;
  private readonly recoveredThreshold: number;
  private readonly deviceFilter?: (device: QuaternionDeviceState) => boolean;
  private readonly roleFilter?: readonly XRDeviceRole[];
  private readonly includeRecoveredEvents: boolean;
  private readonly now: () => number;
  private readonly onStateChange?: (snapshot: PoseReliabilitySnapshot) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly states = new Map<string, PoseReliabilitySnapshot>();

  constructor(options: PoseReliabilityMonitorOptions) {
    if (!options?.registry) {
      throw new Error('PoseReliabilityMonitor requires a QuaternionPoseRegistry instance.');
    }
    if (!options.telemetry) {
      throw new Error('PoseReliabilityMonitor requires a telemetry harness with track().');
    }

    this.registry = options.registry;
    this.telemetry = options.telemetry;
    this.updateIntervalMs = Math.max(8, Math.floor(options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS));
    this.staleThresholdMs = Math.max(16, Math.floor(options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS));
    this.degradedThreshold = Math.max(0, Math.min(1, options.degradedConfidenceThreshold ?? DEFAULT_DEGRADED_THRESHOLD));
    this.recoveredThreshold = Math.max(0, Math.min(1, options.recoveredConfidenceThreshold ?? DEFAULT_RECOVERED_THRESHOLD));
    this.deviceFilter = options.deviceFilter;
    this.roleFilter = options.roleFilter;
    this.includeRecoveredEvents = options.includeRecoveredEvents ?? true;
    this.onStateChange = options.onStateChange;
    this.now = typeof options.now === 'function'
      ? options.now
      : (() => (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()));

    if (options.autoStart !== false) {
      this.start();
    }
  }

  start(immediate = true): this {
    this.stop();
    if (immediate) {
      this.evaluate();
    }
    this.timer = setInterval(() => {
      this.evaluate();
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
    this.states.clear();
  }

  getCurrentStates(): readonly PoseReliabilitySnapshot[] {
    return Array.from(this.states.values());
  }

  evaluate(): readonly PoseReliabilitySnapshot[] {
    const snapshots: PoseReliabilitySnapshot[] = [];
    const seen = new Set<string>();
    const now = this.now();

    for (const device of this.registry.getDevices()) {
      if (this.deviceFilter && !this.deviceFilter(device)) {
        continue;
      }
      if (this.roleFilter && !this.roleFilter.includes(device.role)) {
        continue;
      }

      const confidence = computePoseConfidence(device, {
        staleThresholdMs: this.staleThresholdMs,
        now: () => now,
      });
      const recencyMs = now - (device.current.frameTimestamp ?? now);

      const status = this.resolveStatus(device, confidence, recencyMs);
      const snapshot: PoseReliabilitySnapshot = {
        deviceId: device.id,
        role: device.role,
        handedness: device.handedness,
        reliability: device.reliability,
        status,
        confidence,
        timestamp: device.current.frameTimestamp ?? now,
        recencyMs,
      };

      seen.add(device.id);
      snapshots.push(snapshot);
      this.processSnapshot(snapshot);
    }

    for (const [id, previous] of Array.from(this.states)) {
      if (!seen.has(id) && previous.status !== 'lost') {
        const lost: PoseReliabilitySnapshot = {
          ...previous,
          status: 'lost',
          confidence: 0,
          recencyMs: now - previous.timestamp,
        };
        snapshots.push(lost);
        this.processSnapshot(lost);
      }
    }

    return snapshots;
  }

  private resolveStatus(
    device: QuaternionDeviceState,
    confidence: number,
    recencyMs: number,
  ): PoseReliabilityStatus {
    if (recencyMs > this.staleThresholdMs || device.reliability === 'unavailable') {
      return 'stale';
    }
    if (confidence < this.degradedThreshold) {
      return 'degraded';
    }
    return 'healthy';
  }

  private processSnapshot(snapshot: PoseReliabilitySnapshot): void {
    const previous = this.states.get(snapshot.deviceId);
    let effectiveSnapshot = snapshot;

    if (
      snapshot.status === 'healthy' &&
      previous &&
      previous.status !== 'healthy' &&
      previous.status !== 'lost' &&
      snapshot.confidence < this.recoveredThreshold
    ) {
      effectiveSnapshot = {
        ...snapshot,
        status: previous.status,
      };
    }

    this.states.set(snapshot.deviceId, effectiveSnapshot);

    if (!previous || previous.status !== effectiveSnapshot.status) {
      this.emitTelemetry(effectiveSnapshot, previous);
    }

    if (this.onStateChange) {
      this.onStateChange(effectiveSnapshot);
    }
  }

  private emitTelemetry(snapshot: PoseReliabilitySnapshot, previous?: PoseReliabilitySnapshot | null): void {
    switch (snapshot.status) {
      case 'degraded':
        this.telemetry.track('sensors.pose.degraded', this.createPayload(snapshot), { classification: 'system' });
        break;
      case 'stale':
        this.telemetry.track('sensors.pose.stale', this.createPayload(snapshot), { classification: 'system' });
        break;
      case 'lost':
        this.telemetry.track('sensors.pose.lost', this.createPayload(snapshot), { classification: 'system' });
        break;
      case 'healthy':
        if (previous && this.includeRecoveredEvents && previous.status !== 'healthy') {
          this.telemetry.track('sensors.pose.recovered', this.createPayload(snapshot), { classification: 'system' });
        }
        break;
      default:
        break;
    }
  }

  private createPayload(snapshot: PoseReliabilitySnapshot): Record<string, unknown> {
    return {
      deviceId: snapshot.deviceId,
      role: snapshot.role,
      handedness: snapshot.handedness,
      reliability: snapshot.reliability,
      confidence: Number(snapshot.confidence.toFixed(4)),
      recencyMs: Math.round(snapshot.recencyMs),
      timestamp: snapshot.timestamp,
    };
  }
}

export default PoseReliabilityMonitor;
