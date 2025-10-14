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
}

export default QuaternionFabricRouter;
