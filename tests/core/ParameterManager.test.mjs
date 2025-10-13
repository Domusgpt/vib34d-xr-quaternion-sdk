import test from 'node:test';
import assert from 'node:assert/strict';

import { ParameterManager } from '../../src/core/Parameters.js';
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
