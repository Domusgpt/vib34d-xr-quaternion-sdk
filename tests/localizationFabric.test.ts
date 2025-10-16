import { describe, expect, it } from 'vitest';
import { LocalizationBridge } from '../src/ui/adaptive/localization/LocalizationBridge.ts';
import { QuaternionFabricRouter } from '../src/ui/adaptive/localization/QuaternionFabricRouter.ts';
import { RotorFusionService } from '../src/ui/adaptive/localization/RotorFusionService.ts';
import { IDENTITY_QUATERNION, fromAxisAngle } from '../src/core/quaternion/index.ts';

const timeSource = () => 2000;

describe('Localization quaternion fabric', () => {
  it('normalizes stage and anchor snapshots via LocalizationBridge', () => {
    const bridge = new LocalizationBridge({ timeSource });
    const stageSnapshot = bridge.ingest({
      source: 'openxr-stage',
      timestamp: 1500,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        position: { x: 1.2, y: 0.3, z: -0.5 }
      },
      accuracy: 0.8,
      mappingStatus: 'mapped',
      trackingState: 'tracking',
      drift: 0.1,
    });

    expect(stageSnapshot).not.toBeNull();
    expect(stageSnapshot!.confidence).toBeGreaterThan(0.4);
    expect(stageSnapshot!.latencyMs).toBeGreaterThanOrEqual(0);

    const anchorSnapshot = bridge.ingest({
      source: 'spatial-anchor',
      timestamp: 1500,
      referenceSpace: 'local-floor',
      anchor: {
        id: 'anchor-1',
        transform: {
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          position: { x: 0.8, y: 0.5, z: -0.25 }
        },
        accuracy: 0.65
      },
      drift: 0.05
    });

    expect(anchorSnapshot).not.toBeNull();
    expect(anchorSnapshot!.anchorConfidence).toBeCloseTo(0.65, 2);
  });

  it('routes snapshots and summarizes confidence', () => {
    const bridge = new LocalizationBridge({ timeSource });
    const router = new QuaternionFabricRouter({ historyLimit: 4 });

    const stageSnapshot = bridge.ingest({
      source: 'openxr-stage',
      timestamp: 1600,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        position: { x: 0.4, y: 0.2, z: 0.1 }
      },
      accuracy: 0.75,
      mappingStatus: 'extending',
      trackingState: 'tracking',
      drift: 0.12
    });

    const anchorSnapshot = bridge.ingest({
      source: 'spatial-anchor',
      timestamp: 1600,
      referenceSpace: 'local-floor',
      anchor: {
        id: 'anchor-preview',
        transform: {
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          position: { x: 0.2, y: 0.45, z: 0.05 }
        },
        accuracy: 0.55
      },
      drift: 0.08
    });

    const stageChannel = stageSnapshot ? router.ingest(stageSnapshot) : null;
    const anchorChannel = anchorSnapshot ? router.ingest(anchorSnapshot) : null;
    expect(stageChannel).not.toBeNull();
    expect(anchorChannel).not.toBeNull();

    const summary = router.summarize();
    expect(summary.channelCount).toBeGreaterThan(0);
    expect(summary.overallConfidence).toBeGreaterThan(0);
  });

  it('fuses localization channels with quaternion orientation', () => {
    const bridge = new LocalizationBridge({ timeSource });
    const router = new QuaternionFabricRouter();
    const fusion = new RotorFusionService({ smoothing: 0 });

    const stageSnapshot = bridge.ingest({
      source: 'openxr-stage',
      timestamp: 1700,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        position: { x: 0.5, y: 0.1, z: -0.2 }
      },
      accuracy: 0.8,
      mappingStatus: 'mapped',
      trackingState: 'tracking',
      drift: 0.05
    });

    const channel = stageSnapshot ? router.ingest(stageSnapshot) : null;
    const orientation = fromAxisAngle([0, 1, 0], Math.PI / 4);
    const result = fusion.update({
      channel,
      orientation,
      frameTime: 1.7,
      deltaTime: 0.016
    });

    expect(result.rotor[0]).not.toBeNaN();
    expect(result.localizationUniform[0]).toBeCloseTo(result.stageWeight, 5);
    expect(result.localizationUniform[3]).toBeGreaterThanOrEqual(0);

    const fallback = fusion.update({
      channel: null,
      orientation: IDENTITY_QUATERNION,
      frameTime: 1.716,
      deltaTime: 0.016
    });
    expect(fallback.confidence).toBeGreaterThan(0);
  });

  it('down-weights low reliability anchors before fusion', () => {
    const bridge = new LocalizationBridge({ timeSource });
    const router = new QuaternionFabricRouter({ historyLimit: 4, timeSource });
    const fusion = new RotorFusionService({ smoothing: 0 });

    const stageSnapshot = bridge.ingest({
      source: 'openxr-stage',
      timestamp: 1800,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: 0, y: 0.2588, z: 0, w: 0.9659 },
        position: { x: 0.25, y: 0.12, z: -0.15 }
      },
      accuracy: 0.92,
      mappingStatus: 'mapped',
      trackingState: 'tracking',
      drift: 0.04
    });

    const anchorSnapshot = bridge.ingest({
      source: 'spatial-anchor',
      timestamp: 1802,
      referenceSpace: 'local-floor',
      trackingState: 'lost',
      drift: 0.18,
      anchor: {
        id: 'anchor-low-reliability',
        accuracy: 0.22,
        reliability: 'low',
        transform: {
          orientation: { x: 0, y: 0, z: 0.3827, w: 0.9239 },
          position: { x: 0.3, y: 0.4, z: -0.05 }
        }
      }
    });

    expect(stageSnapshot).not.toBeNull();
    expect(anchorSnapshot).not.toBeNull();

    const stageChannel = stageSnapshot ? router.ingest(stageSnapshot) : null;
    const anchorChannel = anchorSnapshot ? router.ingest(anchorSnapshot) : null;

    expect(stageChannel).not.toBeNull();
    expect(anchorChannel).not.toBeNull();
    expect(stageChannel!.confidence).toBeGreaterThan(anchorChannel!.confidence);

    const summary = router.summarize();
    expect(summary.channelCount).toBe(2);
    expect(summary.overallConfidence).toBeGreaterThan(anchorChannel!.confidence);

    const fused = fusion.update({
      channel: anchorChannel,
      orientation: fromAxisAngle([0, 0, 1], Math.PI / 3),
      frameTime: 1.802,
      deltaTime: 0.016
    });

    expect(fused.reliabilityWeight).toBeCloseTo(0.4, 2);
    expect(fused.confidence).toBeLessThan(stageChannel!.confidence);
    expect(fused.localizationUniform[1]).toBeLessThan(0.3);
  });

  it('arbitrates competing anchors using confidence, reliability, and recency', () => {
    let clock = 2400;
    const now = () => clock;
    const bridge = new LocalizationBridge({ timeSource: now });
    const router = new QuaternionFabricRouter({ timeSource: now });

    const freshAnchor = bridge.ingest({
      source: 'spatial-anchor',
      timestamp: 2385,
      referenceSpace: 'local-floor',
      drift: 0.04,
      anchor: {
        id: 'anchor-fresh',
        accuracy: 0.68,
        reliability: 'high',
        transform: {
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          position: { x: 0.1, y: 0.3, z: -0.2 }
        }
      }
    });

    clock = 2400;
    const staleAnchor = bridge.ingest({
      source: 'spatial-anchor',
      timestamp: 2250,
      referenceSpace: 'local-floor',
      trackingState: 'limited',
      drift: 0.22,
      anchor: {
        id: 'anchor-stale',
        accuracy: 0.82,
        reliability: 'medium',
        transform: {
          orientation: { x: 0, y: 0.2588, z: 0, w: 0.9659 },
          position: { x: -0.4, y: 0.6, z: 0.2 }
        }
      }
    });

    expect(freshAnchor).not.toBeNull();
    expect(staleAnchor).not.toBeNull();

    const freshChannel = freshAnchor ? router.ingest(freshAnchor) : null;
    const staleChannel = staleAnchor ? router.ingest(staleAnchor) : null;
    expect(freshChannel).not.toBeNull();
    expect(staleChannel).not.toBeNull();

    const preferred = router.selectPreferredChannel({ referenceSpace: 'local-floor' });
    expect(preferred?.anchorId).toBe('anchor-fresh');
    expect(preferred?.recencyMs).toBeLessThan(staleChannel!.recencyMs);

    const summaries = router.summarizeAnchors();
    expect(summaries.length).toBe(2);
    expect(summaries[0].representative.anchorId).toBe('anchor-fresh');
    expect(summaries[0].score).toBeGreaterThan(summaries[1].score);

    const fallback = router.selectPreferredChannel({ anchorId: 'unknown', allowFallback: true });
    expect(fallback?.key).toBe(preferred?.key);
  });
});
