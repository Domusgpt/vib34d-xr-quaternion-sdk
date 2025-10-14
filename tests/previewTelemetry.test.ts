import { describe, expect, it } from 'vitest';
import PreviewTelemetry from '../src/dev/preview/PreviewTelemetry.ts';

const IDENTITY_QUATERNION: [number, number, number, number] = [0, 0, 0, 1];

describe('PreviewTelemetry', () => {
  it('generates audio, visual, and prediction telemetry', () => {
    const telemetry = new PreviewTelemetry();
    telemetry.setQuaternion(IDENTITY_QUATERNION);
    telemetry.setAudioBands({ bass: 0.35, mid: 0.42, high: 0.28, energy: 0.48 });
    telemetry.setVisualParams({ dimension: 3.8, morphFactor: 0.5, rotationSpeed: 0.3, universeModifier: 1.1 });
    telemetry.setConfidence(0.86);

    const first = telemetry.update(0.016, 0.016);
    expect(first.audio.energy).toBeGreaterThan(0);
    expect(first.visual.dimension).toBeGreaterThan(0);
    expect(first.stagePosition.length).toBe(3);

    telemetry.update(0.032, 0.016);
    const snapshot = telemetry.getPredictionSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rotor.length).toBe(3);
  });

  it('escalates risk messaging when confidence collapses', () => {
    const telemetry = new PreviewTelemetry();
    telemetry.setQuaternion(IDENTITY_QUATERNION);
    telemetry.setAudioBands({ bass: 0.1, mid: 0.1, high: 0.1, energy: 0.15 });
    telemetry.setVisualParams({ dimension: 3.5, morphFactor: 0.35, rotationSpeed: 0.3, universeModifier: 1 });
    telemetry.setConfidence(0.2);

    telemetry.update(0.05, 0.016);
    const risks = telemetry.listRisks();
    expect(risks.length).toBeGreaterThan(0);
    expect(risks.join(' ')).toContain('Confidence');
  });

  it('captures pulse intensity for the current frame', () => {
    const telemetry = new PreviewTelemetry();
    telemetry.setQuaternion(IDENTITY_QUATERNION);
    telemetry.setAudioBands({ bass: 0.2, mid: 0.25, high: 0.3, energy: 0.4 });
    telemetry.setVisualParams({ dimension: 3.6, morphFactor: 0.4, rotationSpeed: 0.35, universeModifier: 1.05 });
    telemetry.setConfidence(0.75);

    telemetry.triggerPulse(0.85);
    const result = telemetry.update(0.1, 0.016);
    expect(result.pulse).toBeGreaterThan(0.7);
  });
});
