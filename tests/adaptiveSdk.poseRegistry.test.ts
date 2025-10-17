import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/Engine.js', () => ({
  VIB34DIntegratedEngine: class {
    dispose() {}
  },
}));

const BASE_HEAD = {
  id: 'headset-primary',
  role: 'headset' as const,
  handedness: 'none' as const,
  reliability: 'tracked' as const,
  accuracy: 0.92,
};

describe('Adaptive SDK pose registry integration', () => {
  const createFrame = (timestamp: number, orientation = { x: 0, y: 0, z: 0, w: 1 }) => ({
    frameId: `frame-${timestamp}`,
    timestamp,
    referenceSpace: 'local-floor',
    head: {
      ...BASE_HEAD,
      timestamp,
      orientation,
      position: { x: 0, y: 0, z: 0 },
    },
    controllers: [],
    hands: [],
  });

  it('exposes a pose registry and ingests pose frames and samples', async () => {
    const { createAdaptiveSDK } = await import('../src/core/AdaptiveSDK.js');
    const sdk = createAdaptiveSDK();
    expect(sdk.poseRegistry).not.toBeNull();

    const frame = createFrame(24);
    sdk.sensoryBridge.ingest('spatial.pose-frame', frame, 0.9);

    const registry = sdk.poseRegistry;
    expect(registry).not.toBeNull();

    const device = registry!.getDevice('headset-primary');
    expect(device).not.toBeNull();
    expect(device!.current.frameTimestamp).toBe(24);

    sdk.sensoryBridge.ingest(
      'spatial.pose',
      {
        orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
        position: { x: 0.1, y: 0.05, z: -0.02 },
        timestamp: 48,
        reliability: 'estimated',
      },
      0.6
    );

    const updated = registry!.getDevice('headset-primary');
    expect(updated).not.toBeNull();
    expect(updated!.current.orientation[1]).toBeCloseTo(Math.SQRT1_2, 5);
    sdk.dispose();
  });

  it('creates pose registry synchronizers using the shared registry by default', async () => {
    const { createAdaptiveSDK } = await import('../src/core/AdaptiveSDK.js');
    const sdk = createAdaptiveSDK();
    expect(sdk.poseRegistry).not.toBeNull();

    const stubSynchronizer = {
      ingested: [] as Array<{ quaternion: any; context: any }>,
      ingestQuaternion(quaternion: any, context: any = {}) {
        this.ingested.push({ quaternion, context });
        return this;
      },
    };

    const registrySynchronizer = sdk.createQuaternionPoseRegistrySynchronizer({
      synchronizer: stubSynchronizer,
      minConfidence: 0,
    });

    sdk.poseRegistry!.ingestFrame(
      createFrame(64, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 })
    );

    const synced = registrySynchronizer.syncOnce();
    expect(synced).toBe(true);
    expect(stubSynchronizer.ingested.length).toBeGreaterThan(0);

    const info = registrySynchronizer.getLastSyncInfo();
    expect(info?.deviceId).toBe('headset-primary');
    sdk.dispose();
  });
});
