import type { LocalizationSnapshot } from './LocalizationBridge.ts';

export interface FabricChannelState {
  readonly key: string;
  readonly source: string;
  readonly anchorId?: string;
  readonly referenceSpace?: string;
  readonly current: LocalizationSnapshot;
  readonly previous?: LocalizationSnapshot;
  readonly history: readonly LocalizationSnapshot[];
  readonly latencyMs: number;
  readonly jitterMs: number;
  readonly confidence: number;
  readonly drift: number;
  readonly recencyMs: number;
}

export interface FabricSummary {
  readonly overallConfidence: number;
  readonly worstDrift: number;
  readonly averageLatency: number;
  readonly channelCount: number;
}

export interface QuaternionFabricRouterOptions {
  readonly historyLimit?: number;
  readonly timeSource?: () => number;
}

export interface FabricAnchorSummary {
  readonly anchorId?: string;
  readonly referenceSpace?: string;
  readonly score: number;
  readonly representative: FabricChannelState;
  readonly averageConfidence: number;
  readonly averageLatency: number;
  readonly channelCount: number;
  readonly channels: readonly FabricChannelState[];
}

export interface FabricChannelSelectionOptions {
  readonly anchorId?: string;
  readonly referenceSpace?: string;
  readonly maxAgeMs?: number;
  readonly allowFallback?: boolean;
}

interface ChannelRecord {
  key: string;
  source: string;
  anchorId?: string;
  referenceSpace?: string;
  snapshots: LocalizationSnapshot[];
  lastLatency: number;
}

const DEFAULT_HISTORY_LIMIT = 12;

const DEFAULT_TIME_SOURCE = () =>
  (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const RELIABILITY_WEIGHT = {
  high: 1,
  medium: 0.7,
  low: 0.4,
} as const;

function computeChannelKey(snapshot: LocalizationSnapshot): string {
  const anchor = snapshot.provenance.anchorId ?? 'none';
  const space = snapshot.provenance.referenceSpace ?? 'unspecified';
  return `${snapshot.source}::${anchor}::${space}`;
}

function computeChannelConfidence(snapshot: LocalizationSnapshot): number {
  const base = snapshot.confidence;
  const stage = snapshot.stageConfidence;
  const anchor = snapshot.anchorConfidence;
  return clamp01(base * 0.6 + stage * 0.25 + anchor * 0.15);
}

export class QuaternionFabricRouter {
  private readonly channels = new Map<string, ChannelRecord>();
  private readonly historyLimit: number;
  private readonly now: () => number;

  constructor(options: QuaternionFabricRouterOptions = {}) {
    this.historyLimit = Math.max(2, Math.floor(options.historyLimit ?? DEFAULT_HISTORY_LIMIT));
    this.now = options.timeSource ?? DEFAULT_TIME_SOURCE;
  }

  private computeRecencyMs(snapshot: LocalizationSnapshot): number {
    const timestamp = Number(snapshot.timestamp);
    if (!Number.isFinite(timestamp)) {
      return 0;
    }
    return Math.max(0, this.now() - timestamp);
  }

  private scoreChannel(channel: FabricChannelState): number {
    const reliability = channel.current.reliability ?? 'medium';
    const reliabilityWeight = RELIABILITY_WEIGHT[reliability] ?? 0.65;
    const recency = channel.recencyMs;
    const recencyWeight = recency <= 45
      ? 1
      : recency >= 750
        ? 0
        : clamp01(1 - (recency - 45) / 705);
    const jitterPenalty = clamp01(channel.jitterMs / 90);
    const driftPenalty = clamp01(channel.drift);

    return (
      channel.confidence * 0.55
      + reliabilityWeight * 0.25
      + recencyWeight * 0.15
      - driftPenalty * 0.15
      - jitterPenalty * 0.1
    );
  }

  ingest(snapshot: LocalizationSnapshot): FabricChannelState {
    const key = computeChannelKey(snapshot);
    const record = this.channels.get(key) ?? {
      key,
      source: snapshot.source,
      anchorId: snapshot.provenance.anchorId,
      referenceSpace: snapshot.provenance.referenceSpace,
      snapshots: [],
      lastLatency: snapshot.latencyMs,
    } satisfies ChannelRecord;

    const previous = record.snapshots.length ? record.snapshots[record.snapshots.length - 1] : undefined;
    record.snapshots.push(snapshot);
    if (record.snapshots.length > this.historyLimit) {
      record.snapshots.splice(0, record.snapshots.length - this.historyLimit);
    }

    record.lastLatency = snapshot.latencyMs;
    record.anchorId = snapshot.provenance.anchorId;
    record.referenceSpace = snapshot.provenance.referenceSpace;
    this.channels.set(key, record);

    const jitterMs = previous ? Math.abs(snapshot.latencyMs - previous.latencyMs) : 0;
    const confidence = computeChannelConfidence(snapshot);
    const drift = Math.max(snapshot.drift, previous?.drift ?? 0);
    const recencyMs = this.computeRecencyMs(snapshot);

    return Object.freeze({
      key,
      source: record.source,
      anchorId: record.anchorId,
      referenceSpace: record.referenceSpace,
      current: snapshot,
      previous,
      history: [...record.snapshots],
      latencyMs: snapshot.latencyMs,
      jitterMs,
      confidence,
      drift,
      recencyMs,
    });
  }

  getChannel(key: string): FabricChannelState | null {
    const record = this.channels.get(key);
    if (!record || record.snapshots.length === 0) {
      return null;
    }
    const current = record.snapshots[record.snapshots.length - 1];
    const previous = record.snapshots.length > 1 ? record.snapshots[record.snapshots.length - 2] : undefined;

    return Object.freeze({
      key,
      source: record.source,
      anchorId: record.anchorId,
      referenceSpace: record.referenceSpace,
      current,
      previous,
      history: [...record.snapshots],
      latencyMs: current.latencyMs,
      jitterMs: previous ? Math.abs(current.latencyMs - previous.latencyMs) : 0,
      confidence: computeChannelConfidence(current),
      drift: Math.max(current.drift, previous?.drift ?? 0),
      recencyMs: this.computeRecencyMs(current),
    });
  }

  listChannels(): FabricChannelState[] {
    const result: FabricChannelState[] = [];
    for (const [key] of this.channels) {
      const state = this.getChannel(key);
      if (state) {
        result.push(state);
      }
    }
    return result;
  }

  summarize(): FabricSummary {
    const channels = this.listChannels();
    if (channels.length === 0) {
      return { overallConfidence: 0, worstDrift: 0, averageLatency: 0, channelCount: 0 };
    }

    let confidenceSum = 0;
    let latencySum = 0;
    let worstDrift = 0;

    for (const channel of channels) {
      confidenceSum += channel.confidence;
      latencySum += channel.latencyMs;
      worstDrift = Math.max(worstDrift, channel.drift);
    }

    return {
      overallConfidence: confidenceSum / channels.length,
      worstDrift,
      averageLatency: latencySum / channels.length,
      channelCount: channels.length,
    };
  }

  summarizeAnchors(): FabricAnchorSummary[] {
    const groups = new Map<string, FabricChannelState[]>();

    for (const channel of this.listChannels()) {
      const anchorKey = `${channel.anchorId ?? 'none'}::${channel.referenceSpace ?? 'unspecified'}`;
      if (!groups.has(anchorKey)) {
        groups.set(anchorKey, []);
      }
      groups.get(anchorKey)!.push(channel);
    }

    const summaries: FabricAnchorSummary[] = [];

    for (const [, channels] of groups) {
      if (!channels.length) {
        continue;
      }
      let score = -Infinity;
      let representative: FabricChannelState | null = null;
      let confidenceSum = 0;
      let latencySum = 0;

      for (const channel of channels) {
        const channelScore = this.scoreChannel(channel);
        if (channelScore > score) {
          score = channelScore;
          representative = channel;
        }
        confidenceSum += channel.confidence;
        latencySum += channel.latencyMs;
      }

      if (representative) {
        summaries.push({
          anchorId: representative.anchorId,
          referenceSpace: representative.referenceSpace,
          score,
          representative,
          averageConfidence: confidenceSum / channels.length,
          averageLatency: latencySum / channels.length,
          channelCount: channels.length,
          channels: channels.slice(),
        });
      }
    }

    return summaries.sort((a, b) => b.score - a.score);
  }

  selectPreferredChannel(options: FabricChannelSelectionOptions = {}): FabricChannelState | null {
    const { anchorId, referenceSpace, maxAgeMs, allowFallback = true } = options;
    const channels = this.listChannels();
    let best: FabricChannelState | null = null;
    let bestScore = -Infinity;

    for (const channel of channels) {
      if (anchorId && channel.anchorId !== anchorId) {
        continue;
      }
      if (referenceSpace && channel.referenceSpace !== referenceSpace) {
        continue;
      }
      if (maxAgeMs != null && channel.recencyMs > maxAgeMs) {
        continue;
      }
      const score = this.scoreChannel(channel);
      if (score > bestScore) {
        best = channel;
        bestScore = score;
      }
    }

    if (best || !allowFallback) {
      return best;
    }

    let newest: FabricChannelState | null = null;
    let freshestAge = Infinity;
    for (const channel of channels) {
      if (channel.recencyMs < freshestAge) {
        freshestAge = channel.recencyMs;
        newest = channel;
      }
    }

    return newest;
  }
}

export default QuaternionFabricRouter;
