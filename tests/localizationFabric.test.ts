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
});
