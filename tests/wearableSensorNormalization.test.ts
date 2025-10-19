import { describe, expect, it } from 'vitest';
import { SensorSchemaRegistry } from '../src/ui/adaptive/sensors/SensorSchemaRegistry.js';
import { ARVisorWearableAdapter } from '../src/ui/adaptive/sensors/adapters/ARVisorWearableAdapter.js';

const quaternion = (x: number, y: number, z: number, w: number) => ({ x, y, z, w });
const vec3 = (x: number, y: number, z: number) => ({ x, y, z });

describe('Wearable sensor normalization', () => {
  it('normalizes AR visor spatial payloads against SensorSchemaRegistry', () => {
    const registry = new SensorSchemaRegistry();
    const adapter = new ARVisorWearableAdapter({ deviceId: 'visor-001', defaultConfidence: 0.86 });

    const rawSample = {
      deviceId: 'visor-001',
      firmwareVersion: '1.2.3',
      channels: {
        'eye-tracking': { x: 0.45, y: 0.52, depth: 0.31, confidence: 0.91 },
      },
      spatial: {
        planes: {
          timestamp: 1285,
          referenceSpace: { type: 'local-floor', id: 'stage-space' },
          planes: [
            {
              id: 'plane-stage',
              space: { type: 'local-floor', id: 'stage-space' },
              pose: { orientation: quaternion(0, Math.SQRT1_2, 0, Math.SQRT1_2), position: vec3(0.1, 1.4, -0.65) },
              alignment: 'horizontal',
              extent: { width: 2.6, height: 2.4 },
              polygon: [vec3(-1.3, 0, -1.2), vec3(1.3, 0, -1.2), vec3(1.3, 0, 1.2)],
              lastChangedTime: 1200,
              classification: 'floor',
            },
          ],
        },
        anchors: {
          timestamp: 1285,
          referenceSpace: { type: 'local-floor', id: 'stage-space' },
          anchors: [
            {
              id: 'anchor-main',
              space: { type: 'local-floor', id: 'stage-space' },
              pose: { orientation: quaternion(0.02, 0.01, -0.03, 0.999), position: vec3(0.25, 1.35, -0.6) },
              accuracy: 0.22,
              confidence: 0.78,
              lastChangedTime: 1270,
            },
          ],
        },
      },
      metadata: {
        pose: {
          orientation: quaternion(0.02, -0.01, 0.04, 0.999),
          position: vec3(0.12, 1.32, -0.54),
        },
      },
    };

    const normalized = adapter.normalizeSample(rawSample);
    expect(normalized).toBeTruthy();

    const { payload, issues } = registry.validate('wearable.ar-visor', normalized.payload);
    expect(issues).toHaveLength(0);
    expect(payload.deviceId).toBe('visor-001');
    expect(payload.channels['eye-tracking'].payload.x).toBeCloseTo(0.45, 2);
    expect(payload.metadata.pose.orientation.w).toBeCloseTo(0.999, 3);
    expect(payload.channels['spatial.anchors'].payload.anchors[0].pose.orientation.w).toBeCloseTo(0.999, 3);
  });

  it('clamps OpenXR pose payloads via SensorSchemaRegistry', () => {
    const registry = new SensorSchemaRegistry();
    const { payload, issues } = registry.validate('spatial.pose', {
      orientation: { x: '0.0', y: 0.7071068, z: 0, w: 0.7071068 },
      position: { x: '0.25', y: -0.12, z: 1.48 },
    });

    expect(issues).toHaveLength(0);
    expect(payload.orientation.y).toBeCloseTo(0.7071, 4);
    expect(payload.position.x).toBeCloseTo(0.25, 4);
  });
});
