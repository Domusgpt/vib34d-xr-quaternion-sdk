import test from 'node:test';
import assert from 'node:assert/strict';

import { ShaderQuaternionSynchronizer } from '../../src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { composeFourDRotation } from '../../src/math/rotations/FourDRotationComposer.js';

function createStubBridge() {
    return {
        subscribe() {
            return () => {};
        }
    };
}

test('ShaderQuaternionSynchronizer batches updates with context metadata', () => {
    const updates = [];
    const contexts = [];
    const system = {
        parameters: {
            rot4dXY: 0,
            rot4dXZ: 0,
            rot4dYZ: 0,
            rot4dXW: 0,
            rot4dYW: 0,
            rot4dZW: 0,
            chaos: 0.2,
            intensity: 0.7
        },
        batchUpdate(payload, context) {
            updates.push(payload);
            contexts.push(context);
        },
        updateParameter() {
            throw new Error('batchUpdate should have been used');
        }
    };

    const quaternionService = {
        subscribe(handler) {
            this.handler = handler;
            return () => {};
        },
        ingestPrimaryQuaternion() {}
    };

    const synchronizer = new ShaderQuaternionSynchronizer({
        bridge: createStubBridge(),
        systems: { quantum: system },
        quaternionService,
        rotationScale: 2,
        baseAlpha: 0.25,
        minConfidence: 0.45
    });

    const quaternion = { x: 0, y: 0, z: 0, w: 1 };
    const euler = { roll: 0.2, pitch: -0.1, yaw: 0.3 };

    synchronizer.applyNormalizedOrientation(quaternion, { confidence: 0.8, timestamp: 5 }, {
        euler,
        motionEnergy: 0.5,
        timestamp: 5,
        source: 'test',
        uniforms: { left: new Float32Array([0, 0, 0, 1]) }
    });

    assert.equal(updates.length, 1);
    const update = updates[0];
    assert.ok(Number.isFinite(update.rot4dXY));
    assert.ok(Number.isFinite(update.rot4dXZ));
    assert.ok(Number.isFinite(update.rot4dYZ));
    assert(Math.abs(update.rot4dXW + 0.16) < 1e-6);
    assert(Math.abs(update.rot4dYW - 0.48) < 1e-6);
    assert(Math.abs(update.rot4dZW - 0.32) < 1e-6);
    assert(Math.abs(update.chaos - 0.4) < 1e-6);
    assert(Math.abs(update.intensity - 0.86) < 1e-6);

    const context = contexts[0];
    assert.equal(context.systemName, 'quantum');
    assert.equal(context.motionEnergy, 0.5);
    assert.equal(context.confidence, 0.8);
    assert.equal(context.source, 'test');
    assert(context.parameters);
    assert(Math.abs(context.parameters.chaos.target - 0.45) < 1e-6);
    assert(context.rotationUniforms);
    assert.equal(context.rotationUniforms.matrix4.length, 16);
    const expectedRotation = composeFourDRotation(update);
    expectedRotation.matrix4.forEach((value, index) => {
        assert(Math.abs(value - context.rotationUniforms.matrix4[index]) < 1e-4);
    });
    expectedRotation.planeAngles.forEach((value, index) => {
        assert(Math.abs(value - context.rotationUniforms.planeAngles[index]) < 1e-6);
    });
});

test('ShaderQuaternionSynchronizer falls back to updateParameter when batchUpdate is unavailable', () => {
    const calls = [];
    const system = {
        parameters: {
            rot4dXY: 0,
            rot4dXZ: 0,
            rot4dYZ: 0,
            rot4dXW: 0,
            rot4dYW: 0,
            rot4dZW: 0,
            speed: 1
        },
        updateParameter(name, value, context) {
            calls.push({ name, value, context });
            this.parameters[name] = value;
        }
    };

    const synchronizer = new ShaderQuaternionSynchronizer({
        bridge: createStubBridge(),
        systems: { faceted: system },
        quaternionService: {
            subscribe() { return () => {}; },
            ingestPrimaryQuaternion() {}
        },
        rotationScale: 1,
        baseAlpha: 1,
        minConfidence: 0.2
    });

    const quaternion = { x: 0, y: 0, z: 0, w: 1 };
    const euler = { roll: 0.25, pitch: -0.5, yaw: 0.4 };

    synchronizer.applyNormalizedOrientation(quaternion, { confidence: 0.6, timestamp: 10 }, {
        euler,
        motionEnergy: 0.3,
        timestamp: 10,
        source: 'faceted-test'
    });

    assert.equal(calls.length, 7);
    const names = calls.map(call => call.name).sort();
    assert.deepEqual(names, ['rot4dXW', 'rot4dXY', 'rot4dXZ', 'rot4dYW', 'rot4dYZ', 'rot4dZW', 'speed']);
    calls.forEach(call => {
        assert.equal(call.context.systemName, 'faceted');
        assert.equal(call.context.source, 'faceted-test');
        assert(call.context.rotationUniforms);
    });
});
