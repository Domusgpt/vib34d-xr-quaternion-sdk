import test from 'node:test';
import assert from 'node:assert/strict';

import { Vib3PlusEnvironment } from '../../src/vib3plus/Vib3PlusEnvironment.js';
import { ParameterManager, ROTATION_PLANE_KEYS } from '../../src/core/Parameters.js';

test('Vib3PlusEnvironment rotation utilities broadcast updates', () => {
    const parameterManager = new ParameterManager();
    const updates = [];
    const systems = {
        dummy: {
            batchUpdate(payload, context) {
                updates.push({ payload, context });
            }
        }
    };

    const environment = new Vib3PlusEnvironment({ parameterManager, systems });

    const profileState = environment.applyRotationProfile({
        rotations: {
            rot4dXY: 0.3,
            rot4dZW: -0.2
        }
    }, { reason: 'test-profile' });

    assert.equal(parameterManager.getParameter('rot4dXY'), 0.3);
    assert.equal(parameterManager.getParameter('rot4dZW'), -0.2);
    assert.equal(profileState.rot4dXY, 0.3);
    assert.equal(profileState.rot4dZW, -0.2);

    assert.equal(updates.length, 1);
    assert.equal(updates[0].context.reason, 'test-profile');
    assert.equal(updates[0].context.systemName, 'dummy');
    assert.equal(updates[0].payload.rot4dXY, 0.3);
    assert.equal(updates[0].payload.rot4dZW, -0.2);
    assert.ok(updates[0].context.rotationState);

    const deltaState = environment.applyRotationDeltas({ rot4dXY: 0.2 }, { reason: 'delta-update' });
    assert.equal(deltaState.rot4dXY, 0.5);
    assert.equal(parameterManager.getParameter('rot4dXY'), 0.5);
    assert.equal(updates.length, 2);
    assert.equal(updates[1].context.reason, 'delta-update');

    environment.setRotationPlane('rot4dYW', 1.2, { propagate: false });
    assert.equal(parameterManager.getParameter('rot4dYW'), 1.2);
    assert.equal(updates.length, 2);

    const rotationState = environment.getRotationState();
    for (const plane of ROTATION_PLANE_KEYS) {
        assert.ok(Object.prototype.hasOwnProperty.call(rotationState, plane));
    }
});
