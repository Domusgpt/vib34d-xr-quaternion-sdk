import test from 'node:test';
import assert from 'node:assert/strict';

import { SensorSchemaRegistry } from '../../src/ui/adaptive/sensors/SensorSchemaRegistry.js';
import { normalizeXRPosePayload } from '../../src/ui/adaptive/sensors/xr/XRPoseNormalizer.js';
import { SensoryInputBridge } from '../../src/ui/adaptive/SensoryInputBridge.js';

test('normalizeXRPosePayload normalizes typed arrays and preserves reference space metadata', () => {
    const registry = new SensorSchemaRegistry();
    const angle = Math.PI / 4;
    const transform = {
        position: new Float32Array([1, 2, 3]),
        orientation: new Float32Array([0, 0, Math.sin(angle), Math.cos(angle)])
    };

    const { pose } = normalizeXRPosePayload({
        transform,
        space: { type: 'local-floor', id: 'floor-space' }
    }, { registry });

    assert.deepEqual(pose.position, { x: 1, y: 2, z: 3 });
    const magnitude = Math.hypot(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);
    assert(Math.abs(magnitude - 1) < 1e-6, 'orientation should be normalized');
    assert.equal(pose.referenceSpaceType, 'local-floor');
    assert.equal(pose.referenceSpaceId, 'floor-space');
});

test('normalizeXRPosePayload derives confidence from tracking state fallbacks', () => {
    const registry = new SensorSchemaRegistry();
    const { pose } = normalizeXRPosePayload({
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        emulatedPosition: true,
        trackingState: 'paused'
    }, { registry });

    assert.equal(pose.trackingState, 'paused');
    assert(pose.confidence < 0.5, 'confidence should drop when tracking is paused and emulated');
    assert(pose.confidence > 0, 'confidence hint should remain positive');
});

test('SensoryInputBridge prefers the more conservative pose confidence hint', () => {
    const registry = new SensorSchemaRegistry();
    const bridge = new SensoryInputBridge({ schemaRegistry: registry, confidenceThreshold: 0 });

    const adjusted = bridge.computeSpatialPoseConfidence(0.9, { confidence: 0.3 });
    assert.equal(adjusted, 0.3);

    const fallback = bridge.computeSpatialPoseConfidence(0.4, {});
    assert.equal(fallback, 0.4);
});
