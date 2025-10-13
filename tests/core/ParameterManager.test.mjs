import test from 'node:test';
import assert from 'node:assert/strict';

import { ParameterManager, ROTATION_PLANE_KEYS } from '../../src/core/Parameters.js';
import { GeometryLibrary } from '../../src/geometry/GeometryLibrary.js';

test('ParameterManager keeps geometry base and core in sync', () => {
    const manager = new ParameterManager();

    manager.setGeometry(10);
    let description = GeometryLibrary.describeGeometry(manager.getParameter('geometry'));
    assert.equal(manager.getParameter('geometryBase'), description.baseIndex);
    assert.equal(manager.getParameter('geometryCore'), description.coreIndex);

    manager.setParameters({ geometry: 17 });
    description = GeometryLibrary.describeGeometry(manager.getParameter('geometry'));
    assert.equal(manager.getParameter('geometryBase'), description.baseIndex);
    assert.equal(manager.getParameter('geometryCore'), description.coreIndex);

    manager.setParameters({ geometryBase: 3, geometryCore: 0 });
    assert.equal(manager.getParameter('geometryBase'), 3);
    assert.equal(manager.getParameter('geometryCore'), 0);

    manager.resetToDefaults();
    description = GeometryLibrary.describeGeometry(manager.getParameter('geometry'));
    assert.equal(manager.getParameter('geometryBase'), description.baseIndex);
    assert.equal(manager.getParameter('geometryCore'), description.coreIndex);
});

test('ParameterManager rotation helpers apply profiles and deltas', () => {
    const manager = new ParameterManager();

    const profileApplied = manager.applyRotationProfile({
        rotations: {
            rot4dXY: 0.5,
            rot4dZW: -0.25
        }
    });

    assert.equal(profileApplied, true);
    assert.equal(manager.getParameter('rot4dXY'), 0.5);
    assert.equal(manager.getParameter('rot4dZW'), -0.25);

    const stateBeforeDelta = manager.getRotationParameters();
    assert.equal(stateBeforeDelta.rot4dXY, 0.5);
    assert.equal(stateBeforeDelta.rot4dZW, -0.25);

    const deltaApplied = manager.applyRotationDeltas({
        rot4dXY: 0.4,
        rot4dYW: 1.0
    });

    assert.equal(deltaApplied, true);
    assert.equal(manager.getParameter('rot4dXY'), 0.9);
    assert.equal(manager.getParameter('rot4dYW'), 1.0);

    const rotationCopy = manager.getRotationParameters();
    rotationCopy.rot4dXY = 9.9;
    const rotationFresh = manager.getRotationParameters();
    assert.equal(rotationFresh.rot4dXY, 0.9);

    assert.throws(() => manager.setRotationPlane('rot4dQQ', 1));

    manager.setRotationPlane('rot4dXZ', 9.0);
    const clamped = manager.getParameter('rot4dXZ');
    assert.equal(clamped <= 6.28, true);

    for (const plane of ROTATION_PLANE_KEYS) {
        assert.ok(Object.prototype.hasOwnProperty.call(rotationFresh, plane));
    }
});
