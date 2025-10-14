import { normalize as normalizeQuaternion, type Quaternion } from '../../core/quaternion/index.ts';
import {
  LocalizationBridge,
  type LocalizationFrameInput,
  type LocalizationSnapshot,
} from '../../ui/adaptive/localization/LocalizationBridge.ts';
import {
  QuaternionFabricRouter,
  type FabricChannelState,
  type FabricSummary,
} from '../../ui/adaptive/localization/QuaternionFabricRouter.ts';
import {
  RotorFusionService,
  type RotorFusionState,
} from '../../ui/adaptive/localization/RotorFusionService.ts';
import {
  PredictiveRotorCache,
  type PredictiveRotorState,
} from '../../ui/adaptive/localization/PredictiveRotorCache.ts';
import {
  SpatialStoryGraph,
  type StoryGraphUpdateResult,
  type StoryTriggerActivation,
} from '../../ui/adaptive/localization/SpatialStoryGraph.ts';
import type {
  AudioBands,
  VisualParameterVector,
} from '../../ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import { computePreviewAnchorPosition, computePreviewTranslation } from './previewMath.ts';

export interface PreviewTelemetryUpdateResult {
  readonly audio: Required<AudioBands>;
  readonly visual: Required<VisualParameterVector>;
  readonly confidence: number;
  readonly pulse: number;
  readonly stagePosition: readonly [number, number, number];
  readonly anchorPosition: readonly [number, number, number];
  readonly drift: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const defaultAudio = (): Required<AudioBands> => ({ bass: 0, mid: 0, high: 0, energy: 0 });

const defaultVisual = (): Required<VisualParameterVector> => ({
  dimension: 4,
  morphFactor: 0.5,
  rotationSpeed: 0.25,
  universeModifier: 1,
});

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export class PreviewTelemetry {
  private readonly localizationBridge = new LocalizationBridge();
  private readonly fabricRouter = new QuaternionFabricRouter();
  private readonly rotorFusion = new RotorFusionService();
  private readonly rotorCache = new PredictiveRotorCache();
  private readonly storyGraph = new SpatialStoryGraph();

  private quaternion: Quaternion = [0, 0, 0, 1];
  private audio: Required<AudioBands> = defaultAudio();
  private visual: Required<VisualParameterVector> = defaultVisual();
  private confidence = 1;
  private pulseEnergy = 0;

  private lastChannel: FabricChannelState | null = null;
  private fabricSummary: FabricSummary | null = null;
  private lastFusion: RotorFusionState | null = null;
  private lastPrediction: PredictiveRotorState | null = null;
  private lastStory: StoryGraphUpdateResult | null = null;
  private lastAudio: Required<AudioBands> = defaultAudio();
  private lastVisual: Required<VisualParameterVector> = defaultVisual();
  private lastConfidence = 1;
  private lastRisks: string[] = [];

  setQuaternion(quaternion: Quaternion | readonly [number, number, number, number]): void {
    if (!quaternion) {
      return;
    }
    if (Array.isArray(quaternion)) {
      this.quaternion = normalizeQuaternion([
        Number(quaternion[0]) || 0,
        Number(quaternion[1]) || 0,
        Number(quaternion[2]) || 0,
        Number(quaternion[3]) || 1,
      ]);
      return;
    }
    this.quaternion = normalizeQuaternion(quaternion);
  }

  setAudioBands(bands: Partial<AudioBands>): void {
    this.audio = {
      bass: clamp01(bands?.bass ?? this.audio.bass),
      mid: clamp01(bands?.mid ?? this.audio.mid),
      high: clamp01(bands?.high ?? this.audio.high),
      energy: clamp01(bands?.energy ?? this.audio.energy ?? Math.max(this.audio.bass, this.audio.mid, this.audio.high)),
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

  update(frameTime: number, deltaTime: number): PreviewTelemetryUpdateResult {
    const { audio, pulse } = this.resolveAudio(deltaTime);
    let pulseEffect = pulse;
    const visual = this.resolveVisual();
    let resolvedConfidence = this.confidence;

    const stagePosition = computePreviewTranslation(frameTime, audio);
    const anchorPosition = computePreviewAnchorPosition(stagePosition);
    const mappingStatus = resolvedConfidence > 0.85 ? 'mapped' : resolvedConfidence > 0.6 ? 'extending' : 'limited';
    const trackingState = resolvedConfidence > 0.35 ? 'tracking' : 'limited';
    const stageAccuracy = clamp01(0.55 + resolvedConfidence * 0.4);
    const anchorAccuracy = clamp01(0.45 + visual.morphFactor * 0.5);
    const drift = clamp01(Math.abs(audio.mid - audio.bass) * 0.25 + (1 - resolvedConfidence) * 0.4);

    const stageSnapshot = this.safeIngest({
      source: 'openxr-stage',
      timestamp: frameTime * 1000,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: this.quaternion[0], y: this.quaternion[1], z: this.quaternion[2], w: this.quaternion[3] },
        position: { x: stagePosition[0], y: stagePosition[1], z: stagePosition[2] },
      },
      accuracy: stageAccuracy,
      mappingStatus,
      trackingState,
      drift,
    });

    if (stageSnapshot) {
      this.lastChannel = this.fabricRouter.ingest(stageSnapshot);
    }

    const anchorSnapshot = this.safeIngest({
      source: 'spatial-anchor',
      timestamp: frameTime * 1000,
      referenceSpace: 'local-floor',
      anchor: {
        id: 'preview-anchor',
        transform: {
          orientation: { x: this.quaternion[0], y: this.quaternion[1], z: this.quaternion[2], w: this.quaternion[3] },
          position: { x: anchorPosition[0], y: anchorPosition[1], z: anchorPosition[2] },
        },
        accuracy: anchorAccuracy,
        reliability: resolvedConfidence > 0.5 ? 'high' : 'medium',
      },
      drift: drift * 0.75,
    });

    if (anchorSnapshot) {
      this.lastChannel = this.fabricRouter.ingest(anchorSnapshot);
    }

    this.fabricSummary = this.fabricRouter.summarize();

    const fusion = this.rotorFusion.update({
      channel: this.lastChannel,
      orientation: this.quaternion,
      frameTime,
      deltaTime,
    });
    this.lastFusion = fusion;

    const prediction = this.rotorCache.ingest({
      quaternion: this.quaternion,
      rotor: fusion.rotor,
      timestamp: frameTime,
    });
    const forecast = this.rotorCache.forecast(Math.max(deltaTime, 0.011)) ?? prediction;
    this.lastPrediction = forecast ?? prediction;

    let rotorOverride = fusion.rotor;
    if (this.lastPrediction && this.lastPrediction.confidence > 0.05) {
      const weight = clamp01(this.lastPrediction.confidence * 0.85);
      rotorOverride = [
        mix(rotorOverride[0], this.lastPrediction.rotor[0], weight),
        mix(rotorOverride[1], this.lastPrediction.rotor[1], weight),
        mix(rotorOverride[2], this.lastPrediction.rotor[2], weight),
      ];
    }

    const storyResult = this.storyGraph.update({
      frameTime,
      deltaTime,
      snapshot: this.lastChannel?.current ?? null,
      channel: this.lastChannel,
      fusion,
      prediction: this.lastPrediction,
      audio,
      visual,
      confidence: resolvedConfidence,
    });
    this.lastStory = storyResult;

    if (storyResult.pulse) {
      const intensity = clamp01(storyResult.pulse);
      this.triggerPulse(intensity);
      pulseEffect = Math.max(pulseEffect, intensity);
    }

    if (storyResult.audioBoost) {
      audio.bass = clamp01(audio.bass + (storyResult.audioBoost.bass ?? 0));
      audio.mid = clamp01(audio.mid + (storyResult.audioBoost.mid ?? 0));
      audio.high = clamp01(audio.high + (storyResult.audioBoost.high ?? 0));
      audio.energy = clamp01(Math.max(audio.energy, storyResult.audioBoost.energy ?? 0) + (storyResult.audioBoost.energy ?? 0));
    }

    if (storyResult.visualAdjust) {
      visual.dimension += storyResult.visualAdjust.dimension ?? 0;
      visual.morphFactor += storyResult.visualAdjust.morphFactor ?? 0;
      visual.rotationSpeed += storyResult.visualAdjust.rotationSpeed ?? 0;
      visual.universeModifier += storyResult.visualAdjust.universeModifier ?? 0;
    }

    if (storyResult.confidenceNudge) {
      resolvedConfidence = clamp01(resolvedConfidence + storyResult.confidenceNudge);
    }

    audio.energy = clamp01(Math.max(audio.energy, audio.bass, audio.mid, audio.high));

    this.lastAudio = audio;
    this.lastVisual = visual;
    this.lastConfidence = resolvedConfidence;

    this.updateRisks(resolvedConfidence, rotorOverride, drift);

    return {
      audio,
      visual,
      confidence: resolvedConfidence,
      pulse: pulseEffect,
      stagePosition,
      anchorPosition,
      drift,
    };
  }

  listRisks(): string[] {
    return [...this.lastRisks];
  }

  listStoryActivations(): StoryTriggerActivation[] {
    return [...(this.lastStory?.activations ?? [])];
  }

  getPredictionSnapshot(): { confidence: number; horizonMs: number; rotor: readonly [number, number, number] } | null {
    if (!this.lastPrediction) {
      return null;
    }
    return {
      confidence: this.lastPrediction.confidence,
      horizonMs: this.lastPrediction.latency * 1000,
      rotor: this.lastPrediction.rotor,
    };
  }

  private resolveAudio(deltaTime: number): { audio: Required<AudioBands>; pulse: number } {
    const base: Required<AudioBands> = {
      bass: clamp01(this.audio.bass),
      mid: clamp01(this.audio.mid),
      high: clamp01(this.audio.high),
      energy: clamp01(this.audio.energy ?? Math.max(this.audio.bass, this.audio.mid, this.audio.high)),
    };
    const pulse = this.pulseEnergy;
    if (pulse > 0 && deltaTime >= 0) {
      const boost = pulse * 0.75;
      base.bass = clamp01(base.bass + boost * 0.5);
      base.mid = clamp01(base.mid + boost * 0.35);
      base.high = clamp01(base.high + boost * 0.65);
      base.energy = clamp01(Math.max(base.energy, boost));
    }
    this.pulseEnergy = Math.max(0, this.pulseEnergy - deltaTime * 1.5);
    base.energy = clamp01(Math.max(base.energy, base.bass, base.mid, base.high));
    return { audio: base, pulse };
  }

  private resolveVisual(): Required<VisualParameterVector> {
    return {
      dimension: this.visual.dimension,
      morphFactor: this.visual.morphFactor,
      rotationSpeed: this.visual.rotationSpeed,
      universeModifier: this.visual.universeModifier,
    };
  }

  private safeIngest(frame: LocalizationFrameInput): LocalizationSnapshot | null {
    try {
      return this.localizationBridge.ingest(frame);
    } catch {
      return null;
    }
  }

  private updateRisks(confidence: number, rotor: readonly [number, number, number], drift: number): void {
    const risks: string[] = [];

    if (this.fabricSummary && this.fabricSummary.channelCount > 0) {
      if (this.fabricSummary.overallConfidence < 0.55) {
        risks.push(`Localization confidence low (${Math.round(this.fabricSummary.overallConfidence * 100)}%).`);
      }
      if (this.fabricSummary.worstDrift > 0.4) {
        risks.push(`Localization drift elevated (${Math.round(this.fabricSummary.worstDrift * 100)}%).`);
      }
      if (this.fabricSummary.averageLatency > 45) {
        risks.push(`Localization latency average ${this.fabricSummary.averageLatency.toFixed(1)}ms.`);
      }
    }

    if (this.lastChannel && this.lastChannel.latencyMs > 45) {
      risks.push(`Localization channel latency ${this.lastChannel.latencyMs.toFixed(1)}ms may impact late latching.`);
    }

    if (this.lastFusion && this.lastFusion.confidence < 0.45) {
      risks.push(`Rotor fusion confidence ${Math.round(this.lastFusion.confidence * 100)}% is degraded.`);
    }

    if (this.lastPrediction && this.lastPrediction.confidence < 0.3) {
      risks.push(`Predictive rotor confidence ${Math.round(this.lastPrediction.confidence * 100)}% is low.`);
    }

    if (this.lastPrediction && this.lastPrediction.latency > 0.06) {
      risks.push(`Predictive horizon ${(this.lastPrediction.latency * 1000).toFixed(1)}ms may overshoot late-latching budget.`);
    }

    if (confidence < 0.35) {
      risks.push('Confidence below 35% — expect visible jitter in fallback preview.');
    }

    if (drift > 0.45) {
      risks.push(`Drift ${Math.round(drift * 100)}% triggering stabilization overlays.`);
    }

    if (rotor.some(component => Math.abs(component) > 1.5)) {
      risks.push('Rotor override exceeds nominal range — verify quaternion normalization.');
    }

    this.lastRisks = risks;
  }
}

export default PreviewTelemetry;
