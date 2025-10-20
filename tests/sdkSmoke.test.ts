import { describe, expect, it } from 'vitest';

import { createAdaptiveSDK } from '../src/core/AdaptiveSDK.js';
import { QuaternionPoseRegistry } from '../src/core/quaternion/registry.ts';

function createPoseFrame(timestamp: number) {
  return {
    frameId: `frame-${timestamp}`,
    timestamp,
    referenceSpace: 'local' as const,
    metadata: { stageConfidence: 0.92 },
    head: {
      id: 'headset-smoke',
      role: 'headset' as const,
      handedness: 'none' as const,
      timestamp,
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      position: { x: 0, y: 1.6, z: 0 },
      reliability: 'tracked' as const
    },
    controllers: [
      {
        id: 'controller-left',
        role: 'controller' as const,
        handedness: 'left' as const,
        timestamp,
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        position: { x: -0.2, y: 1.4, z: 0.4 },
        reliability: 'tracked' as const,
        buttons: [0],
        triggers: [0]
      }
    ],
    hands: []
  };
}

describe('AdaptiveSDK smoke test', () => {
  it('boots telemetry, sensor, and quaternion subsystems', () => {
    const sdk = createAdaptiveSDK({
      telemetry: { useDefaultProvider: false },
      localization: { quaternion: new QuaternionPoseRegistry({ retentionMs: 250 }) }
    });

    const schema = sdk.registerTelemetryEventSchema('smoke.event', {
      version: 1,
      fields: {
        sample: { type: 'number', required: true }
      }
    });

    expect(schema?.event).toBe('smoke.event');
    expect(sdk.getTelemetryEventSchema('smoke.event')).not.toBeNull();

    sdk.registerSensorSchema('smoke-wearable', {
      normalize(payload = {}) {
        const safe = typeof payload === 'object' ? payload : {};
        return {
          payload: {
            deviceId: safe.deviceId ?? 'smoke-device',
            composite: {
              metadata: { battery: safe.battery ?? 1 },
              channels: {
                heartRate: Number.isFinite(safe.heartRate) ? Number(safe.heartRate) : 60
              }
            }
          },
          issues: []
        };
      }
    });

    const normalized = sdk.sensoryBridge.getSchemaRegistry().validate('smoke-wearable', {
      deviceId: 'demo-device',
      heartRate: 72
    });

    expect(normalized.payload.deviceId).toBe('demo-device');
    expect(normalized.issues).toHaveLength(0);

    const frame = createPoseFrame(Date.now());
    const ingested = sdk.ingestQuaternionFrame(frame);

    expect(ingested.frameId).toBe(frame.frameId);
    expect(sdk.getQuaternionDevices().length).toBeGreaterThan(0);
    expect(sdk.getQuaternionDevice('headset-smoke')).not.toBeNull();

    const rotor = sdk.getQuaternionRotor('headset-smoke');
    expect(rotor).not.toBeNull();
    expect(rotor).toMatchObject({
      xy: expect.any(Number),
      xz: expect.any(Number),
      yz: expect.any(Number),
      xw: expect.any(Number),
      yw: expect.any(Number),
      zw: expect.any(Number)
    });

    const matrix = sdk.getQuaternionMatrix('headset-smoke');
    expect(matrix).not.toBeNull();
    expect(matrix && matrix.length).toBe(16);

    sdk.engine.dispose();
  });
});
