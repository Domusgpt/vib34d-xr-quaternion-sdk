import { describe, it, expect } from 'vitest';
import { dualQuaternionFromRotationTranslation, IDENTITY_QUATERNION } from '../src/core/quaternion/index.ts';
import SpatialStoryGraph from '../src/ui/adaptive/localization/SpatialStoryGraph.ts';
import type { FabricChannelState } from '../src/ui/adaptive/localization/QuaternionFabricRouter.ts';
import type { LocalizationSnapshot } from '../src/ui/adaptive/localization/LocalizationBridge.ts';
import type { RotorFusionState } from '../src/ui/adaptive/localization/RotorFusionService.ts';

function makeChannel(drift: number, confidence: number): FabricChannelState {
  const snapshot: LocalizationSnapshot = {
    id: 'snap',
    source: 'test',
    timestamp: 0,
    local: dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]),
    confidence,
    stageConfidence: confidence,
    anchorConfidence: confidence,
    drift,
    reliability: 'high',
    latencyMs: 18,
    provenance: {},
    metrics: {},
  };

  return {
    key: 'test',
    source: 'test',
    current: snapshot,
    previous: undefined,
    history: [snapshot],
    anchorId: undefined,
    referenceSpace: 'local-floor',
    latencyMs: 18,
    jitterMs: 0,
    confidence,
    drift,
  } satisfies FabricChannelState;
}

const baseFusion: RotorFusionState = {
  rotor: [0, 0, 0],
  quaternion: IDENTITY_QUATERNION,
  translation: [0, 0, 0],
  confidence: 0.9,
  stageWeight: 0.8,
  anchorWeight: 0.7,
  drift: 0.1,
  latencyMs: 12,
  localizationUniform: [0.8, 0.7, 0.1, 0.012],
  reliabilityWeight: 1,
};

describe('SpatialStoryGraph', () => {
  it('emits pulses and adjustments when triggers activate', () => {
    const graph = new SpatialStoryGraph();

    graph.update({
      frameTime: 0,
      deltaTime: 0.016,
      snapshot: null,
      channel: makeChannel(0.1, 0.9),
      fusion: baseFusion,
      prediction: null,
      audio: { bass: 0.2, mid: 0.2, high: 0.2, energy: 0.2 },
      visual: { dimension: 4, morphFactor: 0.5, rotationSpeed: 0.2, universeModifier: 1 },
      confidence: 0.9,
    });

    const result = graph.update({
      frameTime: 0.016,
      deltaTime: 0.016,
      snapshot: null,
      channel: makeChannel(0.5, 0.4),
      fusion: { ...baseFusion, drift: 0.5 },
      prediction: null,
      audio: { bass: 0.2, mid: 0.2, high: 0.2, energy: 0.85 },
      visual: { dimension: 4, morphFactor: 0.5, rotationSpeed: 0.2, universeModifier: 1 },
      confidence: 0.4,
    });

    expect(result.pulse).toBeGreaterThan(0);
    expect(result.audioBoost?.energy ?? 0).toBeGreaterThan(0);
    expect(result.visualAdjust?.morphFactor ?? 0).toBeGreaterThan(0);
    expect(result.confidenceNudge ?? 0).toBeGreaterThan(0);

    const activations = graph.listActivations();
    expect(activations.length).toBeGreaterThanOrEqual(2);
    expect(activations.some(activation => activation.pluginId === 'confidence-dip')).toBe(true);
    expect(activations.some(activation => activation.pluginId === 'drift-excursion')).toBe(true);
    expect(activations.some(activation => activation.pluginId === 'audio-surge')).toBe(true);
  });
});
