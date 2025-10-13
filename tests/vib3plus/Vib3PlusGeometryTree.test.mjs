import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildVib3PlusGeometryTree,
    describeVib3PlusGeometry,
    listVib3PlusCores
} from '../../src/vib3plus/Vib3PlusGeometryTree.js';
import createVib3PlusEnvironment, { Vib3PlusEnvironment } from '../../src/vib3plus/Vib3PlusEnvironment.js';

function createBridgeStub() {
    return {
        subscriptions: new Map(),
        subscribe(channel, handler) {
            this.subscriptions.set(channel, handler);
            return () => this.subscriptions.delete(channel);
        }
    };
}

function createSystemStub() {
    const stub = {
        history: [],
        batchUpdate(update, context) {
            this.history.push({ update, context });
        }
    };
    return stub;
}

const GEOMETRY_COUNT = 24; // 8 base × 3 cores

function validateNode(node, levels) {
    assert.ok(node.id.includes('::'));
    assert.equal(typeof node.geometryIndex, 'number');
    assert.equal(typeof node.displayName, 'string');
    assert.ok(Array.isArray(node.variations));
    assert.equal(node.variations.length, levels.length);
    node.variations.forEach(variation => {
        assert.ok(Number.isInteger(variation.level));
        assert.equal(variation.parameters.geometry, node.geometryIndex);
        assert.equal(variation.parameters.geometryBase, node.base.index);
        assert.equal(variation.parameters.geometryCore, node.core.index);
        assert.ok(variation.parameters.dimension >= 3);
        assert.ok(variation.parameters.dimension <= 4.5);
        ['rot4dXY', 'rot4dXZ', 'rot4dYZ', 'rot4dXW', 'rot4dYW', 'rot4dZW'].forEach(param => {
            assert.ok(Object.prototype.hasOwnProperty.call(variation.parameters, param));
        });
        assert.ok(variation.rotationProfile);
        assert.equal(typeof variation.rotationProfile.amplitude, 'number');
        assert.equal(typeof variation.rotationProfile.baseMagnitude, 'number');
        assert.ok(Array.isArray(variation.rotationProfile.planes));
        variation.rotationProfile.planes.forEach(planeInfo => {
            assert.equal(variation.parameters[planeInfo.plane], planeInfo.value);
            if (variation.rotationProfile.amplitude === 0) {
                assert.equal(planeInfo.value, 0);
            }
        });
    });
}

test('Vib3Plus geometry tree builds the default metadata set', () => {
    const levels = [0, 1, 2];
    const tree = buildVib3PlusGeometryTree(levels);
    assert.equal(tree.length, GEOMETRY_COUNT);
    tree.forEach(node => validateNode(node, levels));
});

test('Vib3Plus geometry tree describes a geometry by index', () => {
    const tree = buildVib3PlusGeometryTree([0]);
    const sample = tree[5];
    const described = describeVib3PlusGeometry(sample.geometryIndex);
    assert.deepEqual(described, sample);
});

test('Vib3Plus geometry tree lists available cores with rotation bias metadata', () => {
    const cores = listVib3PlusCores();
    assert.equal(cores.length, 3);
    cores.forEach(core => {
        assert.ok(Number.isInteger(core.index));
        assert.ok(core.key.endsWith('-core'));
        assert.equal(typeof core.name, 'string');
    });
});

test('Vib3Plus geometry variations seed rotation emphasis for each core', () => {
    const tree = buildVib3PlusGeometryTree([1]);
    const sample = tree.find(node => node.core.key === 'hypersphere-core');
    assert.ok(sample);
    const variation = sample.variations[0];
    const emphasised = variation.rotationProfile.planes.filter(plane => plane.emphasised);
    const baseline = variation.rotationProfile.planes.filter(plane => !plane.emphasised);
    assert.ok(emphasised.length > 0);
    emphasised.forEach(plane => {
        baseline.forEach(basePlane => {
            assert.ok(Math.abs(plane.value) >= Math.abs(basePlane.value));
        });
    });
});

test('Vib3PlusEnvironment applies geometry nodes and broadcasts updates', () => {
    const system = createSystemStub();
    const env = createVib3PlusEnvironment({
        systems: { test: system },
        geometryLevels: [0, 1]
    });

    const targetIndex = 7;
    const result = env.applyGeometryIndex(targetIndex, { level: 1 });
    assert.equal(result.node.geometryIndex, targetIndex);
    assert.equal(env.parameterManager.getParameter('geometry'), targetIndex);
    assert.equal(system.history.length > 0, true);
    const lastUpdate = system.history.at(-1);
    assert.equal(lastUpdate.update.geometry, targetIndex);
    assert.equal(lastUpdate.update.geometryBase, result.node.base.index);
    assert.equal(lastUpdate.update.geometryCore, result.node.core.index);
});

test('Vib3PlusEnvironment creates a synchronizer bound to a sensory bridge', () => {
    const env = new Vib3PlusEnvironment();
    const bridge = createBridgeStub();
    const synchronizer = env.createSynchronizer(bridge, { rotationScale: 1.5 });
    assert.ok(synchronizer);
    assert.ok(bridge.subscriptions.size > 0);
    synchronizer.stop();
});
