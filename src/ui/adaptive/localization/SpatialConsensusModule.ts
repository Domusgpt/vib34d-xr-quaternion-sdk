import {
  blendDualQuaternionArray,
  composeRotorFromDualQuaternion,
  dualQuaternionFromRotationTranslation,
  IDENTITY_QUATERNION,
  type DualQuaternion,
  type Rotor6,
} from '../../../core/quaternion/index.ts';
import type { FabricChannelState } from './QuaternionFabricRouter.ts';
import type { LocalizationSnapshot, LocalizationReliability } from './LocalizationBridge.ts';

export interface SpatialConsensusModuleOptions {
  readonly staleAfterMs?: number;
  readonly timeSource?: () => number;
  readonly weightFloor?: number;
}

export interface SpatialConsensusIngestOptions {
  readonly weightOverride?: number;
  readonly reliabilityOverride?: LocalizationReliability;
  readonly anchorId?: string | null;
  readonly referenceSpace?: string | null;
}

export interface SpatialConsensusParticipant {
  readonly id: string;
  readonly anchorId?: string;
  readonly referenceSpace?: string;
  readonly snapshot: LocalizationSnapshot;
  readonly weight: number;
  readonly lastUpdated: number;
  readonly recencyMs: number;
  readonly jitterMs: number;
}

export interface SpatialConsensusResult {
  readonly anchorId?: string;
  readonly referenceSpace?: string;
  readonly participantCount: number;
  readonly participants: readonly SpatialConsensusParticipant[];
  readonly consensus: DualQuaternion;
  readonly rotor: Rotor6;
  readonly confidence: number;
  readonly reliability: LocalizationReliability;
  readonly averageLatency: number;
  readonly drift: number;
  readonly recencyMs: number;
  readonly timestamp: number;
}

export interface SpatialConsensusQuery {
  readonly anchorId?: string;
  readonly referenceSpace?: string;
  readonly maxAgeMs?: number;
  readonly minParticipants?: number;
  readonly fallbackToAnyAnchor?: boolean;
}

interface ParticipantRecord {
  readonly id: string;
  anchorId?: string;
  referenceSpace?: string;
  snapshot: LocalizationSnapshot;
  weight: number;
  lastUpdated: number;
  lastLatency: number;
}

const DEFAULT_STALE_AFTER_MS = 2000;
const RELIABILITY_WEIGHT: Record<LocalizationReliability, number> = {
  high: 1,
  medium: 0.7,
  low: 0.45,
};

const IDENTITY_DUAL = dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function computeSnapshotWeight(
  snapshot: LocalizationSnapshot,
  reliability: LocalizationReliability,
  weightFloor: number
): number {
  const confidence = clamp01(snapshot.confidence ?? 0.5);
  const stageConfidence = clamp01(snapshot.stageConfidence ?? confidence);
  const anchorConfidence = clamp01(snapshot.anchorConfidence ?? confidence);
  const driftPenalty = clamp01(snapshot.drift ?? 0);
  const latency = Math.max(snapshot.latencyMs ?? 0, 0);
  const latencyPenalty = latency <= 33 ? 0 : clamp01((latency - 33) / 120);
  const reliabilityWeight = RELIABILITY_WEIGHT[reliability] ?? RELIABILITY_WEIGHT.medium;

  const rawWeight =
    confidence * 0.45 +
    stageConfidence * 0.25 +
    anchorConfidence * 0.2 +
    (1 - driftPenalty) * 0.07 +
    (1 - latencyPenalty) * 0.03;

  return Math.max(weightFloor, clamp01(rawWeight) * reliabilityWeight);
}

function resolveReliabilityLevel(score: number): LocalizationReliability {
  if (score >= 0.75) {
    return 'high';
  }
  if (score >= 0.5) {
    return 'medium';
  }
  return 'low';
}

export class SpatialConsensusModule {
  private readonly participants = new Map<string, ParticipantRecord>();

  private readonly staleAfterMs: number;

  private readonly weightFloor: number;

  private readonly now: () => number;

  constructor(options: SpatialConsensusModuleOptions = {}) {
    this.staleAfterMs = Math.max(100, Math.floor(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
    this.weightFloor = clamp01(options.weightFloor ?? 0.05);
    this.now = options.timeSource ?? (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
  }

  ingest(participantId: string, snapshot: LocalizationSnapshot, options: SpatialConsensusIngestOptions = {}): SpatialConsensusParticipant {
    if (!participantId) {
      throw new Error('SpatialConsensusModule.ingest requires a participant identifier.');
    }

    const reliability = options.reliabilityOverride ?? snapshot.reliability ?? 'medium';
    const weightOverride = options.weightOverride;
    const anchorId = options.anchorId ?? snapshot.provenance?.anchorId ?? undefined;
    const referenceSpace = options.referenceSpace ?? snapshot.provenance?.referenceSpace ?? undefined;

    const computedWeight = Number.isFinite(weightOverride as number) && (weightOverride as number) > 0
      ? (weightOverride as number)
      : computeSnapshotWeight(snapshot, reliability, this.weightFloor);

    const now = this.now();
    const previous = this.participants.get(participantId);
    const lastLatency = snapshot.latencyMs ?? previous?.lastLatency ?? 0;
    const record: ParticipantRecord = {
      id: participantId,
      anchorId: anchorId ?? undefined,
      referenceSpace: referenceSpace ?? undefined,
      snapshot,
      weight: computedWeight,
      lastUpdated: now,
      lastLatency,
    };

    this.participants.set(participantId, record);
    this.prune(now);

    return this.createParticipantView(record, previous, now);
  }

  ingestFabricChannel(channel: FabricChannelState, participantId?: string): SpatialConsensusParticipant {
    const id = participantId ?? channel.key;
    return this.ingest(id, channel.current, {
      anchorId: channel.anchorId,
      referenceSpace: channel.referenceSpace,
      weightOverride: channel.confidence,
    });
  }

  ingestFabricRouter(
    router: { listChannels(): readonly FabricChannelState[] },
    options: { participantPrefix?: string } = {}
  ): readonly SpatialConsensusParticipant[] {
    const prefix = options.participantPrefix ?? 'fabric';
    const now = this.now();
    const participants: SpatialConsensusParticipant[] = [];
    for (const channel of router.listChannels()) {
      const participantId = `${prefix}:${channel.key}`;
      participants.push(this.ingestFabricChannel(channel, participantId));
    }
    this.prune(now);
    return participants;
  }

  getParticipant(participantId: string): SpatialConsensusParticipant | null {
    const record = this.participants.get(participantId);
    if (!record) {
      return null;
    }
    return this.createParticipantView(record, null, this.now());
  }

  listParticipants(): readonly SpatialConsensusParticipant[] {
    const now = this.now();
    this.prune(now);
    const participants: SpatialConsensusParticipant[] = [];
    for (const record of this.participants.values()) {
      participants.push(this.createParticipantView(record, null, now));
    }
    return participants;
  }

  getConsensus(query: SpatialConsensusQuery = {}): SpatialConsensusResult | null {
    const now = this.now();
    this.prune(now);

    const {
      anchorId,
      referenceSpace,
      maxAgeMs,
      minParticipants = 1,
      fallbackToAnyAnchor = true,
    } = query;

    const selection = this.selectParticipants(anchorId, referenceSpace, maxAgeMs, now);

    if (selection.length < minParticipants && fallbackToAnyAnchor && (anchorId || referenceSpace)) {
      selection.splice(0, selection.length, ...this.selectParticipants(undefined, undefined, maxAgeMs, now));
    }

    if (selection.length < minParticipants) {
      return null;
    }

    const weights = selection.map(participant => participant.weight);
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    if (weightSum <= 0) {
      return null;
    }

    const normalized = weights.map(weight => weight / weightSum);
    const dualQuaternions = selection.map(participant => participant.snapshot.local ?? IDENTITY_DUAL);
    const consensus = blendDualQuaternionArray(dualQuaternions, normalized);
    const rotor = composeRotorFromDualQuaternion(consensus);

    let confidence = 0;
    let latency = 0;
    let drift = 0;
    let reliabilityScore = 0;
    let recencyMs = 0;

    for (let i = 0; i < selection.length; i += 1) {
      const participant = selection[i];
      const weight = normalized[i];
      const snapshot = participant.snapshot;
      confidence += (snapshot.confidence ?? 0) * weight;
      latency += (snapshot.latencyMs ?? 0) * weight;
      drift += (snapshot.drift ?? 0) * weight;
      const reliabilityWeight = RELIABILITY_WEIGHT[snapshot.reliability ?? 'medium'] ?? RELIABILITY_WEIGHT.medium;
      reliabilityScore += reliabilityWeight * weight;
      recencyMs = Math.max(recencyMs, participant.recencyMs);
    }

    const resolvedAnchor = selection.reduce<string | undefined>((best, participant, index) => {
      if (!participant.anchorId) {
        return best;
      }
      if (!best) {
        return participant.anchorId;
      }
      const candidateWeight = normalized[index];
      const bestIndex = selection.findIndex(value => value.anchorId === best);
      const bestWeight = bestIndex >= 0 ? normalized[bestIndex] : 0;
      return candidateWeight > bestWeight ? participant.anchorId : best;
    }, anchorId ?? undefined);

    const resolvedReferenceSpace = selection.reduce<string | undefined>((best, participant, index) => {
      if (!participant.referenceSpace) {
        return best;
      }
      if (!best) {
        return participant.referenceSpace;
      }
      const candidateWeight = normalized[index];
      const bestIndex = selection.findIndex(value => value.referenceSpace === best);
      const bestWeight = bestIndex >= 0 ? normalized[bestIndex] : 0;
      return candidateWeight > bestWeight ? participant.referenceSpace : best;
    }, referenceSpace ?? undefined);

    const participants = Object.freeze(selection.slice()) as readonly SpatialConsensusParticipant[];

    return Object.freeze({
      anchorId: resolvedAnchor,
      referenceSpace: resolvedReferenceSpace,
      participantCount: participants.length,
      participants,
      consensus,
      rotor,
      confidence: clamp01(confidence),
      reliability: resolveReliabilityLevel(clamp01(reliabilityScore)),
      averageLatency: latency,
      drift: clamp01(drift),
      recencyMs,
      timestamp: now,
    });
  }

  clear(): void {
    this.participants.clear();
  }

  private selectParticipants(
    anchorId: string | undefined,
    referenceSpace: string | undefined,
    maxAgeMs: number | undefined,
    now: number
  ): SpatialConsensusParticipant[] {
    const selection: SpatialConsensusParticipant[] = [];
    for (const record of this.participants.values()) {
      const recencyMs = Math.max(0, now - record.snapshot.timestamp);
      if (maxAgeMs != null && recencyMs > maxAgeMs) {
        continue;
      }
      if (anchorId && record.anchorId !== anchorId) {
        continue;
      }
      if (referenceSpace && record.referenceSpace !== referenceSpace) {
        continue;
      }
      selection.push(this.createParticipantView(record, null, now));
    }
    return selection.sort((a, b) => b.weight - a.weight);
  }

  private prune(now: number = this.now()): void {
    for (const [id, record] of this.participants) {
      if (now - record.lastUpdated > this.staleAfterMs) {
        this.participants.delete(id);
      }
    }
  }

  private createParticipantView(
    record: ParticipantRecord,
    previous: ParticipantRecord | null,
    now: number
  ): SpatialConsensusParticipant {
    const recencyMs = Math.max(0, now - record.snapshot.timestamp);
    const jitterMs = previous ? Math.abs((record.snapshot.latencyMs ?? 0) - (previous.lastLatency ?? 0)) : 0;
    return Object.freeze({
      id: record.id,
      anchorId: record.anchorId,
      referenceSpace: record.referenceSpace,
      snapshot: record.snapshot,
      weight: record.weight,
      lastUpdated: record.lastUpdated,
      recencyMs,
      jitterMs,
    });
  }
}

export default SpatialConsensusModule;
