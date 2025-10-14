import test from 'node:test';
import assert from 'node:assert/strict';

import {
    composeFourDRotation,
    applyRotationMatrix,
    FOUR_D_ROTATION_PLANES
} from '../../src/math/rotations/FourDRotationComposer.js';

const PLANE_AXES = {
    rot4dXY: [0, 1],
    rot4dXZ: [0, 2],
    rot4dYZ: [1, 2],
    rot4dXW: [0, 3],
    rot4dYW: [1, 3],
    rot4dZW: [2, 3]
};

function applySequentialRotations(angles, vector) {
    const result = vector.slice();
    for (const plane of FOUR_D_ROTATION_PLANES) {
        const axes = PLANE_AXES[plane];
        const angle = angles[plane] || 0;
        if (!angle) {
            continue;
        }
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const a = result[axes[0]];
        const b = result[axes[1]];
        result[axes[0]] = c * a - s * b;
        result[axes[1]] = s * a + c * b;
    }
    return result;
}

test('composeFourDRotation returns identity for zero angles', () => {
    const rotation = composeFourDRotation({});
    rotation.matrix4.forEach((value, index) => {
        const row = index % 4;
        const col = Math.floor(index / 4);
        const expected = row === col ? 1 : 0;
        assert(Math.abs(value - expected) < 1e-6);
    });
    assert(rotation.isIdentity);
    assert.equal(rotation.matrix3.length, 9);
    assert.equal(rotation.planeAngles.length, 6);
});

test('composeFourDRotation matches sequential plane rotations', () => {
    const angles = {
        rot4dXY: 0.3,
        rot4dXZ: -0.2,
        rot4dYZ: 0.5,
        rot4dXW: -0.15,
        rot4dYW: 0.4,
        rot4dZW: -0.25
    };
    const vector = new Float32Array([0.6, -0.3, 0.2, 0.5]);

    const rotation = composeFourDRotation(angles);
    const transformed = applyRotationMatrix(rotation.matrix4, vector);
    const sequential = applySequentialRotations(angles, Array.from(vector));

    transformed.forEach((value, index) => {
        assert(Math.abs(value - sequential[index]) < 1e-5);
    });
});

test('applyRotationMatrix handles missing matrices gracefully', () => {
    assert.equal(applyRotationMatrix(null, [1, 0, 0, 1]), null);
    assert.equal(applyRotationMatrix(undefined, [1, 0, 0, 1]), null);
    assert.equal(applyRotationMatrix(new Float32Array(16), null), null);
});
