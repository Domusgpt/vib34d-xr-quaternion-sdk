import { describe, expect, it } from 'vitest';

import { SpatialConsensusModule } from '../src/ui/adaptive/localization/SpatialConsensusModule.ts';
import { QuaternionFabricRouter } from '../src/ui/adaptive/localization/QuaternionFabricRouter.ts';
import {
  dualQuaternionFromRotationTranslation,
  IDENTITY_QUATERNION,
} from '../src/core/quaternion/index.ts';
import type { LocalizationSnapshot } from '../src/ui/adaptive/localization/LocalizationBridge.ts';

function createSnapshot(overrides: Partial<LocalizationSnapshot> = {}): LocalizationSnapshot {
  return {
    id: overrides.id ?? `anchor-${Math.random().toString(16).slice(2, 8)}`,
    source: overrides.source ?? 'fabric',
    timestamp: overrides.timestamp ?? 0,
    frameId: overrides.frameId ?? 'frame-0',
    local:
      overrides.local
      ?? dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0]),
    global: overrides.global ?? null,
    confidence: overrides.confidence ?? 0.75,
    stageConfidence: overrides.stageConfidence ?? 0.75,
    anchorConfidence: overrides.anchorConfidence ?? 0.75,
    drift: overrides.drift ?? 0.1,
    reliability: overrides.reliability ?? 'medium',
    latencyMs: overrides.latencyMs ?? 12,
    provenance: overrides.provenance ?? { anchorId: 'anchor-default', referenceSpace: 'local-floor' },
    metrics: overrides.metrics ?? { accuracy: 0.8, rawConfidence: 0.7 },
  } satisfies LocalizationSnapshot;
}

describe('SpatialConsensusModule', () => {
  it('weights participants by confidence and reliability', () => {
    let currentTime = 1000;
    const module = new SpatialConsensusModule({
      timeSource: () => currentTime,
      weightFloor: 0.01,
    });

    const strongSnapshot = createSnapshot({
      id: 'primary',
      confidence: 0.95,
      stageConfidence: 0.94,
      anchorConfidence: 0.92,
      reliability: 'high',
      latencyMs: 10,
      provenance: { anchorId: 'shared-anchor', referenceSpace: 'stage' },
    });

    const weakSnapshot = createSnapshot({
      id: 'secondary',
      confidence: 0.45,
      stageConfidence: 0.4,
      anchorConfidence: 0.35,
      reliability: 'medium',
      drift: 0.5,
      latencyMs: 55,
      provenance: { anchorId: 'shared-anchor', referenceSpace: 'stage' },
      local: dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [1, 0, 0]),
    });

    module.ingest('primary', strongSnapshot);
    module.ingest('secondary', weakSnapshot);

    const consensus = module.getConsensus({ anchorId: 'shared-anchor', minParticipants: 1 });
    expect(consensus).not.toBeNull();
    expect(consensus?.participantCount).toBe(2);
    expect(consensus?.confidence ?? 0).toBeGreaterThan(0.7);
    expect(Math.abs(consensus?.rotor.xw ?? 0)).toBeLessThan(0.6);
    expect(consensus?.reliability).toBe('high');
  });

  it('prunes stale participants based on the configured window', () => {
    let now = 0;
    const module = new SpatialConsensusModule({ staleAfterMs: 500, timeSource: () => now });

    module.ingest('alpha', createSnapshot({ timestamp: 0 }));
    expect(module.listParticipants()).toHaveLength(1);

    now = 600;
    expect(module.listParticipants()).toHaveLength(0);
    expect(module.getParticipant('alpha')).toBeNull();
  });

  it('falls back to healthiest anchor when preferred anchor is unavailable', () => {
    let now = 0;
    const module = new SpatialConsensusModule({ timeSource: () => now });

    module.ingest('primary', createSnapshot({
      confidence: 0.9,
      provenance: { anchorId: 'primary-anchor', referenceSpace: 'local-floor' },
    }));

    module.ingest('secondary', createSnapshot({
      confidence: 0.6,
      provenance: { anchorId: 'secondary-anchor', referenceSpace: 'local-floor' },
    }));

    const consensus = module.getConsensus({ anchorId: 'missing-anchor', fallbackToAnyAnchor: true });
    expect(consensus).not.toBeNull();
    expect(consensus?.anchorId).toBe('primary-anchor');
  });

  it('ingests fabric router channels using structured participant IDs', () => {
    let now = 0;
    const router = new QuaternionFabricRouter({ timeSource: () => now });
    const module = new SpatialConsensusModule({ timeSource: () => now });

    router.ingest(createSnapshot({
      id: 'router-primary',
      confidence: 0.88,
      provenance: { anchorId: 'router-anchor', referenceSpace: 'stage' },
    }));

    const participants = module.ingestFabricRouter(router, { participantPrefix: 'router' });
    expect(participants).toHaveLength(1);
    expect(module.listParticipants()).toHaveLength(1);

    const consensus = module.getConsensus({ anchorId: 'router-anchor' });
    expect(consensus?.participantCount).toBe(1);
    expect(consensus?.participants[0].id).toContain('router:');
  });
});
