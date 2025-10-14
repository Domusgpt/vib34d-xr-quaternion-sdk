import {
  normalize as normalizeQuaternion,
  type Quaternion,
} from '../../../../core/quaternion/index.ts';
import {
  LocalizationBridge,
  type LocalizationFrameInput,
  type LocalizationSnapshot,
} from '../../localization/LocalizationBridge.ts';
import {
  QuaternionFabricRouter,
  type FabricChannelState,
  type FabricSummary,
} from '../../localization/QuaternionFabricRouter.ts';
import {
  RotorFusionService,
  type RotorFusionState,
} from '../../localization/RotorFusionService.ts';
import type { MultiLayerGlassComposer } from './MultiLayerGlassComposer.ts';
import {
  WebXRQuaternionBridge,
  type AudioBands,
  type UpdateUniformOptions,
  type VisualParameterVector,
  type XRFrameLike,
} from './WebXRQuaternionBridge.ts';

export interface GlassUniformControllerOptions {
  readonly composer: MultiLayerGlassComposer;
  readonly bridge?: WebXRQuaternionBridge;
  readonly localizationBridge?: LocalizationBridge;
  readonly localizationRouter?: QuaternionFabricRouter;
  readonly rotorFusion?: RotorFusionService;
  readonly logger?: { warn?: (...args: unknown[]) => void };
}

export interface UniformUpdateOptions {
  readonly referenceSpace: unknown;
  readonly frameTime: number;
  readonly deltaTime: number;
  readonly audioOverride?: Partial<AudioBands>;
  readonly visualOverride?: Partial<VisualParameterVector>;
  readonly confidenceOverride?: number;
  readonly quaternionOverride?: Quaternion | readonly [number, number, number, number];
}

interface QuaternionLike {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly w?: number;
}

interface XRViewerPoseLike {
  readonly views: readonly [{ transform: { orientation?: QuaternionLike } }, ...Array<{ transform: { orientation?: QuaternionLike } }>];
  readonly transform?: { orientation?: QuaternionLike };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const defaultAudio = (): Required<AudioBands> => ({ bass: 0, mid: 0, high: 0, energy: 0 });

const defaultVisual = (): Required<VisualParameterVector> => ({
  dimension: 4,
  morphFactor: 0.5,
  rotationSpeed: 0.25,
  universeModifier: 1,
});

function resolveQuaternion(source?: Quaternion | readonly [number, number, number, number] | QuaternionLike | null): Quaternion | null {
  if (!source) {
    return null;
  }
  if (Array.isArray(source)) {
    return normalizeQuaternion([
      Number(source[0]) || 0,
      Number(source[1]) || 0,
      Number(source[2]) || 0,
      Number(source[3]) || 1,
    ]);
  }
  if (typeof source === 'object' && 'x' in source && 'y' in source && 'z' in source && 'w' in source) {
    return normalizeQuaternion([
      Number(source.x) || 0,
      Number(source.y) || 0,
      Number(source.z) || 0,
      Number(source.w) || 1,
    ]);
  }
  return null;
}

export class GlassUniformController {
  readonly composer: MultiLayerGlassComposer;
  readonly bridge: WebXRQuaternionBridge;
  readonly localizationBridge: LocalizationBridge;
  readonly localizationRouter: QuaternionFabricRouter;
  readonly rotorFusion: RotorFusionService;

  private quaternion: Quaternion = [0, 0, 0, 1];
  private audio: Required<AudioBands> = defaultAudio();
  private visual: Required<VisualParameterVector> = defaultVisual();
  private confidence = 1;
  private pulseEnergy = 0;
  private lastAudio: Required<AudioBands> = defaultAudio();
  private lastVisual: Required<VisualParameterVector> = defaultVisual();
  private lastConfidence = 1;
  private lastFusion: RotorFusionState | null = null;
  private lastLocalizationChannel: FabricChannelState | null = null;
  private fabricSummary: FabricSummary | null = null;
  private readonly logger?: { warn?: (...args: unknown[]) => void };

  constructor(options: GlassUniformControllerOptions) {
    if (!options?.composer) {
      throw new Error('GlassUniformController requires a MultiLayerGlassComposer instance');
    }
    this.composer = options.composer;
    this.bridge = options.bridge ?? new WebXRQuaternionBridge({ composer: options.composer, logger: options.logger });
    this.localizationBridge = options.localizationBridge ?? new LocalizationBridge();
    this.localizationRouter = options.localizationRouter ?? new QuaternionFabricRouter();
    this.rotorFusion = options.rotorFusion ?? new RotorFusionService();
    this.logger = options.logger;
  }

  setQuaternion(quaternion: Quaternion | readonly [number, number, number, number]): void {
    const normalized = resolveQuaternion(quaternion);
    if (normalized) {
      this.quaternion = normalized;
    }
  }

  setAudioBands(bands: Partial<AudioBands>): void {
    this.audio = {
      bass: clamp01(bands.bass ?? this.audio.bass),
      mid: clamp01(bands.mid ?? this.audio.mid),
      high: clamp01(bands.high ?? this.audio.high),
      energy: clamp01(bands.energy ?? this.audio.energy ?? Math.max(this.audio.bass, this.audio.mid, this.audio.high)),
    };
  }

  setVisualParams(params: Partial<VisualParameterVector>): void {
    this.visual = {
      dimension: Number(params.dimension ?? this.visual.dimension) || 0,
      morphFactor: Number(params.morphFactor ?? this.visual.morphFactor) || 0,
      rotationSpeed: Number(params.rotationSpeed ?? this.visual.rotationSpeed) || 0,
      universeModifier: Number(params.universeModifier ?? this.visual.universeModifier) || 0,
    };
  }

  setConfidence(value: number): void {
    this.confidence = clamp01(value);
  }

  triggerPulse(intensity: number): void {
    this.pulseEnergy = Math.max(this.pulseEnergy, clamp01(intensity));
  }

  ingestLocalizationFrame(frame: LocalizationFrameInput): {
    snapshot: LocalizationSnapshot | null;
    channel: FabricChannelState | null;
  } {
    const snapshot = this.localizationBridge.ingest(frame);
    if (!snapshot) {
      return { snapshot: null, channel: this.lastLocalizationChannel };
    }
    const channel = this.localizationRouter.ingest(snapshot);
    this.lastLocalizationChannel = channel;
    this.fabricSummary = this.localizationRouter.summarize();
    return { snapshot, channel };
  }

  update(frame: XRFrameLike, options: UniformUpdateOptions): Float32Array | null {
    if (!frame || typeof frame.getViewerPose !== 'function') {
      throw new Error('GlassUniformController.update requires a valid XR frame');
    }

    const pose = frame.getViewerPose(options.referenceSpace) as XRViewerPoseLike | null;
    const orientation =
      resolveQuaternion(options.quaternionOverride) ||
      resolveQuaternion(pose?.transform?.orientation) ||
      resolveQuaternion(pose?.views?.[0]?.transform.orientation) ||
      this.quaternion;

    this.quaternion = orientation ?? this.quaternion;

    const deltaTime = options.deltaTime;
    const resolvedAudio = this.resolveAudio(deltaTime, options.audioOverride);
    const resolvedVisual = this.resolveVisual(options.visualOverride);
    const resolvedConfidence = clamp01(options.confidenceOverride ?? this.confidence);

    const fusion = this.rotorFusion.update({
      channel: this.lastLocalizationChannel,
      orientation: this.quaternion,
      frameTime: options.frameTime,
      deltaTime,
    });
    this.lastFusion = fusion;
    this.lastAudio = resolvedAudio;
    this.lastVisual = resolvedVisual;
    this.lastConfidence = resolvedConfidence;

    const localizationPayload: UpdateUniformOptions['localization'] = {
      stageConfidence: fusion.stageWeight,
      anchorConfidence: fusion.anchorWeight,
      drift: fusion.drift,
      latencyMs: fusion.latencyMs,
    };

    try {
      return this.bridge.updateFromXRFrame(frame, {
        referenceSpace: options.referenceSpace,
        frameTime: options.frameTime,
        deltaTime: options.deltaTime,
        audio: resolvedAudio,
        confidence: resolvedConfidence,
        visualParams: resolvedVisual,
        rotorOverride: fusion.rotor,
        localization: localizationPayload,
      });
    } catch (error) {
      this.logger?.warn?.('[GlassUniformController] Failed to update uniform buffer', error);
      return null;
    }
  }

  listLocalizationRisks(): string[] {
    const risks: string[] = [];
    if (this.fabricSummary && this.fabricSummary.channelCount > 0) {
      if (this.fabricSummary.overallConfidence < 0.55) {
        risks.push(`Localization confidence low (${Math.round(this.fabricSummary.overallConfidence * 100)}%).`);
      }
      if (this.fabricSummary.worstDrift > 0.4) {
        risks.push(`Localization drift elevated (${Math.round(this.fabricSummary.worstDrift * 100)}%).`);
      }
      if (this.fabricSummary.averageLatency > 45) {
        risks.push(`Localization average latency ${this.fabricSummary.averageLatency.toFixed(1)}ms exceeds late-latching budget.`);
      }
    }
    if (this.lastLocalizationChannel && this.lastLocalizationChannel.latencyMs > 45) {
      risks.push(`Localization latency ${this.lastLocalizationChannel.latencyMs.toFixed(1)}ms may impact late latching.`);
    }
    if (this.lastFusion && this.lastFusion.confidence < 0.45) {
      risks.push(`Rotor fusion confidence ${Math.round(this.lastFusion.confidence * 100)}% may introduce jitter.`);
    }
    return risks;
  }

  getLastFusion(): RotorFusionState | null {
    return this.lastFusion;
  }

  getLastLocalizationChannel(): FabricChannelState | null {
    return this.lastLocalizationChannel;
  }

  getFabricSummary(): FabricSummary | null {
    return this.fabricSummary;
  }

  getLastAudio(): Required<AudioBands> {
    return this.lastAudio;
  }

  getLastVisual(): Required<VisualParameterVector> {
    return this.lastVisual;
  }

  getLastConfidence(): number {
    return this.lastConfidence;
  }

  private resolveAudio(deltaTime: number, override?: Partial<AudioBands>): Required<AudioBands> {
    const base = {
      bass: clamp01(override?.bass ?? this.audio.bass),
      mid: clamp01(override?.mid ?? this.audio.mid),
      high: clamp01(override?.high ?? this.audio.high),
      energy: clamp01(override?.energy ?? this.audio.energy ?? Math.max(this.audio.bass, this.audio.mid, this.audio.high)),
    } satisfies Required<AudioBands>;

    if (this.pulseEnergy > 0 && deltaTime >= 0) {
      const boost = this.pulseEnergy * 0.75;
      base.bass = clamp01(base.bass + boost * 0.5);
      base.mid = clamp01(base.mid + boost * 0.35);
      base.high = clamp01(base.high + boost * 0.65);
      base.energy = clamp01(Math.max(base.energy, boost));
      this.pulseEnergy = Math.max(0, this.pulseEnergy - deltaTime * 1.5);
    }

    return base;
  }

  private resolveVisual(override?: Partial<VisualParameterVector>): Required<VisualParameterVector> {
    return {
      dimension: Number(override?.dimension ?? this.visual.dimension) || 0,
      morphFactor: Number(override?.morphFactor ?? this.visual.morphFactor) || 0,
      rotationSpeed: Number(override?.rotationSpeed ?? this.visual.rotationSpeed) || 0,
      universeModifier: Number(override?.universeModifier ?? this.visual.universeModifier) || 0,
    };
  }
}

export default GlassUniformController;
