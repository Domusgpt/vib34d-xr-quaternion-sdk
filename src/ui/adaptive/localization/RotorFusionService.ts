import {
  IDENTITY_QUATERNION,
  type Quaternion,
  type Vec3,
  composeRotorFromDualQuaternion,
  deriveRotorSnapshot,
  extractTranslation,
  normalize as normalizeQuaternion,
} from '../../../core/quaternion/index.ts';
import type { FabricChannelState } from './QuaternionFabricRouter.ts';
import type { LocalizationSnapshot, LocalizationReliability } from './LocalizationBridge.ts';

export interface RotorFusionOptions {
  readonly smoothing?: number;
  readonly localizationWeight?: number;
  readonly baselineConfidence?: number;
}

export interface RotorFusionUpdate {
  readonly channel?: FabricChannelState | null;
  readonly orientation: Quaternion;
  readonly frameTime: number;
  readonly deltaTime: number;
}

export interface RotorFusionState {
  readonly rotor: [number, number, number];
  readonly quaternion: Quaternion;
  readonly translation: Vec3;
  readonly confidence: number;
  readonly stageWeight: number;
  readonly anchorWeight: number;
  readonly drift: number;
  readonly latencyMs: number;
  readonly localizationUniform: [number, number, number, number];
  readonly reliabilityWeight: number;
}

const RELIABILITY_WEIGHT: Record<LocalizationReliability, number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function resolveSnapshot(channel?: FabricChannelState | null): LocalizationSnapshot | null {
  return channel?.current ?? null;
}

export class RotorFusionService {
  private readonly smoothing: number;
  private readonly localizationWeight: number;
  private readonly baselineConfidence: number;
  private lastResult: RotorFusionState | null = null;

  constructor(options: RotorFusionOptions = {}) {
    this.smoothing = clamp01(options.smoothing ?? 0.35);
    this.localizationWeight = clamp01(options.localizationWeight ?? 0.85);
    this.baselineConfidence = clamp01(options.baselineConfidence ?? 0.55);
  }

  update(update: RotorFusionUpdate): RotorFusionState {
    const orientation = normalizeQuaternion(update.orientation ?? IDENTITY_QUATERNION);
    const snapshot = resolveSnapshot(update.channel);

    const orientationRotor = deriveRotorSnapshot(orientation);
    let fusedRotor: [number, number, number] = [...orientationRotor.rotor4d] as [number, number, number];
    let translation: Vec3 = [0, 0, 0];

    let stageWeight = 0;
    let anchorWeight = 0;
    let drift = 0;
    let latencyMs = update.channel?.current.latencyMs ?? 0;
    let reliabilityWeight = 1;
    let confidence = this.baselineConfidence;

    if (snapshot) {
      const localizationRotor = composeRotorFromDualQuaternion(snapshot.local);
      stageWeight = clamp01(snapshot.stageConfidence);
      anchorWeight = clamp01(snapshot.anchorConfidence);
      drift = clamp01(snapshot.drift);
      latencyMs = snapshot.latencyMs;
      reliabilityWeight = RELIABILITY_WEIGHT[snapshot.reliability] ?? 0.65;
      confidence = clamp01(update.channel?.confidence ?? snapshot.confidence ?? this.baselineConfidence);

      const weight = clamp01(confidence * reliabilityWeight * this.localizationWeight);
      fusedRotor = [
        mix(fusedRotor[0], localizationRotor.xw, weight),
        mix(fusedRotor[1], localizationRotor.yw, weight),
        mix(fusedRotor[2], localizationRotor.zw, weight),
      ];
      translation = extractTranslation(snapshot.local);
    }

    if (this.lastResult) {
      const smoothing = this.smoothing;
      fusedRotor = [
        mix(fusedRotor[0], this.lastResult.rotor[0], smoothing),
        mix(fusedRotor[1], this.lastResult.rotor[1], smoothing),
        mix(fusedRotor[2], this.lastResult.rotor[2], smoothing),
      ];
    }

    const localizationUniform: [number, number, number, number] = [
      stageWeight,
      anchorWeight,
      drift,
      Math.min(latencyMs / 1000, 16),
    ];

    const result: RotorFusionState = {
      rotor: fusedRotor,
      quaternion: orientation,
      translation,
      confidence: clamp01(confidence * reliabilityWeight),
      stageWeight,
      anchorWeight,
      drift,
      latencyMs,
      localizationUniform,
      reliabilityWeight,
    };

    this.lastResult = result;
    return result;
  }

  getLastResult(): RotorFusionState | null {
    return this.lastResult;
  }
}

export default RotorFusionService;
