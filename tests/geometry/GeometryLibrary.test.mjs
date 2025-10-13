import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryLibrary } from '../../src/geometry/GeometryLibrary.js';

const TOTAL_BASE = GeometryLibrary.baseGeometries.length;
const TOTAL_CORES = GeometryLibrary.coreVariants.length;

function expectedIndex(baseIndex, coreIndex) {
    return coreIndex * TOTAL_BASE + baseIndex;
}

test('GeometryLibrary normalizes indices across wrap-around values', () => {
    const total = TOTAL_BASE * TOTAL_CORES;
    const baseIndex = 3;
    const coreIndex = 2;
    const index = expectedIndex(baseIndex, coreIndex);
    assert.equal(GeometryLibrary.normalizeGeometryIndex(index + total * 3), index);
    assert.equal(GeometryLibrary.normalizeGeometryIndex(index - total * 2), index);
});

test('GeometryLibrary resolves geometry indices from base/core keys', () => {
    const baseKey = GeometryLibrary.baseGeometries[4].key; // klein-bottle
    const coreKey = GeometryLibrary.coreVariants[1].key; // hypersphere
    const expected = expectedIndex(4, 1);

    const resolved = GeometryLibrary.resolveGeometryIndex({ baseKey, coreKey });
    assert.equal(resolved, expected);

    const described = GeometryLibrary.describeByComponents({ baseKey: baseKey.toUpperCase(), coreKey });
    assert.ok(described);
    assert.equal(described.baseKey, baseKey);
    assert.equal(described.coreKey, coreKey);
});

test('GeometryLibrary encodeGeometryIndex validates bounds', () => {
    assert.equal(GeometryLibrary.encodeGeometryIndex(-1, 0), null);
    assert.equal(GeometryLibrary.encodeGeometryIndex(TOTAL_BASE, 0), null);
    assert.equal(GeometryLibrary.encodeGeometryIndex(0, TOTAL_CORES), null);
    assert.equal(GeometryLibrary.encodeGeometryIndex(2, 1), expectedIndex(2, 1));
});
