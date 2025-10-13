import test from 'node:test';
import assert from 'node:assert/strict';

import { ShaderQuaternionSynchronizer } from '../../src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { IDENTITY_QUATERNION } from '../../src/core/quaternions/QuaternionFieldService.js';

const noopLogger = { warn() {} };

function createStubBridge() {
    return {
        subscribe() {
            return () => {};
        }
    };
}

test('ShaderQuaternionSynchronizer prefers batchUpdate when available', () => {
    const updates = [];
    const values = new Map([
        ['rot4dXW', 0],
        ['rot4dYW', 0],
        ['rot4dZW', 0],
        ['speed', 1]
    ]);

    const system = {
        batchUpdate(payload, context) {
            updates.push({ payload, context });
            Object.entries(payload).forEach(([key, value]) => values.set(key, value));
        },
        getParameter(param) {
            return values.get(param);
        }
    };

    const synchronizer = new ShaderQuaternionSynchronizer({
        bridge: createStubBridge(),
        systems: { faceted: system },
        quaternionService: { subscribe: () => () => {} },
        rotationScale: 1,
        baseAlpha: 1,
        minConfidence: 0,
        logger: noopLogger
    });

    synchronizer.applyNormalizedOrientation(IDENTITY_QUATERNION, {
        confidence: 1,
        timestamp: 0,
        source: 'test'
    }, {
        motionEnergy: 0.25,
        euler: { roll: 0.1, pitch: 0.2, yaw: 0.3 }
    });

    assert.equal(updates.length, 1, 'batchUpdate should be called once');
    const { payload, context } = updates[0];
    assert.deepEqual(Object.keys(payload).sort(), ['rot4dXW', 'rot4dYW', 'rot4dZW', 'speed']);
    assert.ok(Math.abs(payload.rot4dXW - 0.2) < 1e-6);
    assert.ok(Math.abs(payload.rot4dYW - 0.3) < 1e-6);
    assert.ok(Math.abs(payload.rot4dZW - 0.1) < 1e-6);
    assert.ok(Math.abs(payload.speed - (1 + 0.25 * 0.6)) < 1e-6);
    assert.equal(context.confidence, 1);
    assert.equal(context.motionEnergy, 0.25);
});

test('ShaderQuaternionSynchronizer falls back to updateParameter when batchUpdate is missing', () => {
    const calls = [];
    const values = new Map([
        ['rot4dXW', 0],
        ['rot4dYW', 0],
        ['rot4dZW', 0],
        ['speed', 1]
    ]);

    const system = {
        updateParameter(param, value) {
            calls.push([param, value]);
            values.set(param, value);
        },
        getParameter(param) {
            return values.get(param);
        }
    };

    const synchronizer = new ShaderQuaternionSynchronizer({
        bridge: createStubBridge(),
        systems: { faceted: system },
        quaternionService: { subscribe: () => () => {} },
        rotationScale: 1,
        baseAlpha: 1,
        minConfidence: 0,
        logger: noopLogger
    });

    synchronizer.applyNormalizedOrientation(IDENTITY_QUATERNION, {
        confidence: 1,
        timestamp: 0,
        source: 'test'
    }, {
        motionEnergy: 0.25,
        euler: { roll: 0.1, pitch: 0.2, yaw: 0.3 }
    });

    const paramNames = calls.map(([param]) => param);
    assert.deepEqual(paramNames, ['rot4dXW', 'rot4dYW', 'rot4dZW', 'speed']);
});
