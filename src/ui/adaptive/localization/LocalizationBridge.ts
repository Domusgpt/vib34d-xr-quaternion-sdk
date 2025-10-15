import {
  IDENTITY_QUATERNION,
  type DualQuaternion,
  type Quaternion,
  type Vec3,
  dualQuaternionFromMatrix4,
  dualQuaternionFromRotationTranslation,
  extractTranslation,
  matrix4ToQuaternion,
  matrix4ToTranslation,
  normalize as normalizeQuaternion,
} from '../../../core/quaternion/index.ts';

export type LocalizationReliability = 'high' | 'medium' | 'low';

export interface QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TransformLike {
  readonly matrix?: readonly number[] | Float32Array;
  readonly orientation?: QuaternionLike | readonly [number, number, number, number];
  readonly position?: Vec3Like | readonly [number, number, number];
}

export interface LocalizationFrameInput {
  readonly source: string;
  readonly timestamp?: number;
  readonly frameId?: string;
  readonly referenceSpace?: string;
  readonly trackingState?: string;
  readonly mappingStatus?: string;
  readonly accuracy?: number;
  readonly drift?: number;
  readonly stageTransform?: TransformLike;
  readonly globalTransform?: TransformLike;
  readonly anchor?: {
    readonly id?: string;
    readonly transform?: TransformLike;
    readonly accuracy?: number;
    readonly reliability?: LocalizationReliability;
  };
  readonly transform?: TransformLike;
}

export interface LocalizationSnapshot {
  readonly id: string;
  readonly source: string;
  readonly timestamp: number;
  readonly frameId?: string;
  readonly local: DualQuaternion;
  readonly global?: DualQuaternion;
  readonly confidence: number;
  readonly stageConfidence: number;
  readonly anchorConfidence: number;
  readonly drift: number;
  readonly reliability: LocalizationReliability;
  readonly latencyMs: number;
  readonly provenance: {
    readonly referenceSpace?: string;
    readonly anchorId?: string;
    readonly trackingState?: string;
    readonly mappingStatus?: string;
  };
  readonly metrics: {
    readonly accuracy?: number;
    readonly rawConfidence?: number;
  };
}

export type LocalizationAdapter = (
  frame: LocalizationFrameInput,
  context: LocalizationAdapterContext
) => LocalizationSnapshot | null;

export interface LocalizationAdapterContext {
  readonly now: () => number;
  readonly previous: LocalizationSnapshot | null;
  readonly toDualQuaternion: (transform?: TransformLike | null) => DualQuaternion | null;
  readonly toQuaternion: (transform?: TransformLike | null) => Quaternion;
  readonly toTranslation: (transform?: TransformLike | null) => Vec3;
}

export interface LocalizationBridgeOptions {
  readonly adapters?: Record<string, LocalizationAdapter>;
  readonly timeSource?: () => number;
  readonly defaultReliability?: LocalizationReliability;
}

interface SnapshotDraft {
  readonly id: string;
  readonly source: string;
  readonly frameId?: string;
  readonly timestamp: number;
  readonly local: DualQuaternion;
  readonly global?: DualQuaternion;
  readonly confidence: number;
  readonly stageConfidence: number;
  readonly anchorConfidence: number;
  readonly drift: number;
  readonly reliability: LocalizationReliability;
  readonly provenance: LocalizationSnapshot['provenance'];
  readonly metrics: LocalizationSnapshot['metrics'];
}

const DEFAULT_TIME_SOURCE = () =>
  (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());

const RELIABILITY_WEIGHT: Record<LocalizationReliability, number> = {
  high: 1,
  medium: 0.65,
  low: 0.35,
};

const ARKIT_MAPPING_WEIGHTS: Record<string, number> = {
  mapped: 1,
  extending: 0.85,
  limited: 0.55,
  relocalizing: 0.45,
  'not-available': 0.2,
};

const TRACKING_STATE_RELIABILITY: Record<string, LocalizationReliability> = {
  tracking: 'high',
  normal: 'high',
  limited: 'medium',
  relocalizing: 'medium',
  paused: 'low',
  lost: 'low',
  unavailable: 'low',
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function quaternionFromLike(source?: TransformLike['orientation']): Quaternion {
  if (!source) {
    return IDENTITY_QUATERNION;
  }
  if (Array.isArray(source)) {
    return normalizeQuaternion([source[0] || 0, source[1] || 0, source[2] || 0, source[3] || 1]);
  }
  return normalizeQuaternion([
    Number(source.x) || 0,
    Number(source.y) || 0,
    Number(source.z) || 0,
    Number(source.w) || 1,
  ]);
}

function vec3FromLike(source?: TransformLike['position']): Vec3 {
  if (!source) {
    return [0, 0, 0];
  }
  if (Array.isArray(source)) {
    return [Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0];
  }
  return [Number(source.x) || 0, Number(source.y) || 0, Number(source.z) || 0];
}

function resolveReliability(state?: string | null): LocalizationReliability {
  if (!state) {
    return 'medium';
  }
  const normalized = state.toLowerCase();
  return TRACKING_STATE_RELIABILITY[normalized] ?? 'medium';
}

function resolveStageConfidence(mappingStatus?: string | null): number {
  if (!mappingStatus) {
    return 0.75;
  }
  const normalized = mappingStatus.toLowerCase().replace(/\s+/g, '-');
  if (ARKIT_MAPPING_WEIGHTS[normalized] != null) {
    return ARKIT_MAPPING_WEIGHTS[normalized];
  }
  return 0.65;
}

function createAdapterContext(
  now: () => number,
  previous: LocalizationSnapshot | null
): LocalizationAdapterContext {
  return {
    now,
    previous,
    toDualQuaternion(transform) {
      if (!transform) {
        return null;
      }
      if (transform.matrix && transform.matrix.length === 16) {
        return dualQuaternionFromMatrix4(Array.from(transform.matrix));
      }
      const orientation = quaternionFromLike(transform.orientation);
      const translation = vec3FromLike(transform.position);
      return dualQuaternionFromRotationTranslation(orientation, translation);
    },
    toQuaternion(transform) {
      if (transform?.matrix && transform.matrix.length === 16) {
        return matrix4ToQuaternion(Array.from(transform.matrix));
      }
      return quaternionFromLike(transform?.orientation);
    },
    toTranslation(transform) {
      if (transform?.matrix && transform.matrix.length === 16) {
        return matrix4ToTranslation(Array.from(transform.matrix));
      }
      return vec3FromLike(transform?.position);
    },
  };
}

function finalizeSnapshot(draft: SnapshotDraft, now: number): LocalizationSnapshot {
  const latencyMs = Math.max(0, now - draft.timestamp);
  const drift = clamp01(draft.drift);
  const confidence = clamp01(draft.confidence);

  return Object.freeze({
    ...draft,
    confidence,
    drift,
    latencyMs,
  });
}

const defaultAdapters: Record<string, LocalizationAdapter> = {
  arkit(frame, context) {
    const local =
      context.toDualQuaternion(frame.transform ?? frame.stageTransform) ??
      dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]);

    const anchor = frame.anchor?.transform
      ? context.toDualQuaternion(frame.anchor.transform)
      : null;

    const stageConfidence = clamp01(resolveStageConfidence(frame.mappingStatus));
    const anchorConfidence = clamp01(frame.anchor?.accuracy ?? frame.accuracy ?? 0.5);
    const reliability = frame.anchor?.reliability ?? resolveReliability(frame.trackingState);

    const draft: SnapshotDraft = {
      id: frame.frameId ?? `${frame.source}:${Math.round(context.now())}`,
      source: frame.source,
      frameId: frame.frameId,
      timestamp: frame.timestamp ?? context.now(),
      local,
      global: anchor ?? undefined,
      stageConfidence,
      anchorConfidence,
      confidence: clamp01((stageConfidence * 0.7 + anchorConfidence * 0.3) * RELIABILITY_WEIGHT[reliability]),
      drift: frame.drift ?? 0,
      reliability,
      provenance: {
        referenceSpace: frame.referenceSpace,
        anchorId: frame.anchor?.id,
        trackingState: frame.trackingState,
        mappingStatus: frame.mappingStatus,
      },
      metrics: {
        accuracy: frame.accuracy ?? frame.anchor?.accuracy,
        rawConfidence: (stageConfidence + anchorConfidence) * 0.5,
      },
    };

    return finalizeSnapshot(draft, context.now());
  },

  'openxr-stage'(frame, context) {
    const local =
      context.toDualQuaternion(frame.stageTransform ?? frame.transform) ??
      dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]);

    const stageConfidence = clamp01(frame.accuracy ?? 0.85);
    const reliability = resolveReliability(frame.trackingState ?? 'tracking');
    const anchorConfidence = clamp01(frame.anchor?.accuracy ?? 0);

    const drift = frame.drift ?? (() => {
      if (!context.previous) {
        return 0;
      }
      const previousTranslation = extractTranslation(context.previous.local);
      const currentTranslation = extractTranslation(local);
      const dx = currentTranslation[0] - previousTranslation[0];
      const dy = currentTranslation[1] - previousTranslation[1];
      const dz = currentTranslation[2] - previousTranslation[2];
      const distance = Math.hypot(dx, dy, dz);
      return clamp01(distance * 2);
    })();

    const draft: SnapshotDraft = {
      id: frame.frameId ?? `${frame.source}:${Math.round(context.now())}`,
      source: frame.source,
      frameId: frame.frameId,
      timestamp: frame.timestamp ?? context.now(),
      local,
      global: frame.globalTransform ? context.toDualQuaternion(frame.globalTransform) ?? undefined : undefined,
      stageConfidence,
      anchorConfidence,
      confidence: clamp01((stageConfidence + anchorConfidence * 0.5) * RELIABILITY_WEIGHT[reliability]),
      drift,
      reliability,
      provenance: {
        referenceSpace: frame.referenceSpace ?? 'local-floor',
        anchorId: frame.anchor?.id,
        trackingState: frame.trackingState ?? 'tracking',
      },
      metrics: {
        accuracy: frame.accuracy,
        rawConfidence: stageConfidence,
      },
    };

    return finalizeSnapshot(draft, context.now());
  },

  'spatial-anchor'(frame, context) {
    const anchor = frame.anchor?.transform ?? frame.transform;
    const local =
      context.toDualQuaternion(anchor) ??
      dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]);

    const accuracy = clamp01(frame.anchor?.accuracy ?? frame.accuracy ?? 0.5);
    const reliability = frame.anchor?.reliability ?? resolveReliability(frame.trackingState);

    const draft: SnapshotDraft = {
      id: frame.frameId ?? `${frame.source}:${Math.round(context.now())}`,
      source: frame.source,
      frameId: frame.frameId,
      timestamp: frame.timestamp ?? context.now(),
      local,
      stageConfidence: clamp01(frame.accuracy ?? 0.35),
      anchorConfidence: accuracy,
      global: frame.globalTransform ? context.toDualQuaternion(frame.globalTransform) ?? undefined : undefined,
      confidence: clamp01((accuracy * 0.8 + 0.2) * RELIABILITY_WEIGHT[reliability]),
      drift: frame.drift ?? 0,
      reliability,
      provenance: {
        referenceSpace: frame.referenceSpace,
        anchorId: frame.anchor?.id,
        trackingState: frame.trackingState,
      },
      metrics: {
        accuracy,
        rawConfidence: accuracy,
      },
    };

    return finalizeSnapshot(draft, context.now());
  },
};

export class LocalizationBridge {
  private readonly adapters = new Map<string, LocalizationAdapter>();
  private readonly snapshots = new Map<string, LocalizationSnapshot>();
  private readonly now: () => number;
  private readonly defaultReliability: LocalizationReliability;

  constructor(options: LocalizationBridgeOptions = {}) {
    this.now = options.timeSource ?? DEFAULT_TIME_SOURCE;
    this.defaultReliability = options.defaultReliability ?? 'medium';

    const provided = options.adapters ?? {};
    const merged = { ...defaultAdapters, ...provided };
    for (const [key, adapter] of Object.entries(merged)) {
      if (typeof adapter === 'function') {
        this.adapters.set(key, adapter);
      }
    }
  }

  registerAdapter(source: string, adapter: LocalizationAdapter): void {
    if (!source || typeof adapter !== 'function') {
      throw new Error('LocalizationBridge.registerAdapter requires a source key and adapter.');
    }
    this.adapters.set(source, adapter);
  }

  ingest(frame: LocalizationFrameInput): LocalizationSnapshot | null {
    if (!frame?.source) {
      throw new Error('LocalizationBridge.ingest requires a frame with a source.');
    }

    const adapter = this.adapters.get(frame.source) ?? defaultAdapters[frame.source];
    if (!adapter) {
      throw new Error(`No localization adapter registered for source "${frame.source}".`);
    }

    const previous = this.snapshots.get(frame.source) ?? null;
    const context = createAdapterContext(this.now, previous);
    const snapshot = adapter(frame, context);
    if (!snapshot) {
      return null;
    }

    const normalized = this.applyDefaults(snapshot, previous);
    this.snapshots.set(frame.source, normalized);
    return normalized;
  }

  getLastSnapshot(source: string): LocalizationSnapshot | null {
    return this.snapshots.get(source) ?? null;
  }

  private applyDefaults(
    snapshot: LocalizationSnapshot,
    previous: LocalizationSnapshot | null
  ): LocalizationSnapshot {
    const reliability = snapshot.reliability ?? this.defaultReliability;
    const stageConfidence = clamp01(snapshot.stageConfidence ?? 0);
    const anchorConfidence = clamp01(snapshot.anchorConfidence ?? 0);
    const baseConfidence = snapshot.confidence ?? (stageConfidence + anchorConfidence) * 0.5;

    let drift = snapshot.drift ?? 0;
    if (drift === 0 && previous) {
      const currentTranslation = extractTranslation(snapshot.local);
      const previousTranslation = extractTranslation(previous.local);
      const dx = currentTranslation[0] - previousTranslation[0];
      const dy = currentTranslation[1] - previousTranslation[1];
      const dz = currentTranslation[2] - previousTranslation[2];
      const distance = Math.hypot(dx, dy, dz);
      drift = clamp01(distance * 1.5);
    }

    const metrics = {
      accuracy: snapshot.metrics.accuracy,
      rawConfidence: snapshot.metrics.rawConfidence ?? baseConfidence,
    };

    const finalized: SnapshotDraft = {
      id: snapshot.id,
      source: snapshot.source,
      frameId: snapshot.frameId,
      timestamp: snapshot.timestamp,
      local: snapshot.local,
      global: snapshot.global,
      stageConfidence,
      anchorConfidence,
      confidence: clamp01(baseConfidence * RELIABILITY_WEIGHT[reliability]),
      drift,
      reliability,
      provenance: snapshot.provenance,
      metrics,
    };

    return finalizeSnapshot(finalized, this.now());
  }
}

export default LocalizationBridge;
