const PLANE_SEQUENCE = [
    { key: 'rot4dXY', axes: [0, 1] },
    { key: 'rot4dXZ', axes: [0, 2] },
    { key: 'rot4dYZ', axes: [1, 2] },
    { key: 'rot4dXW', axes: [0, 3] },
    { key: 'rot4dYW', axes: [1, 3] },
    { key: 'rot4dZW', axes: [2, 3] }
];

const AXIS_COUNT = 4;

function createIdentityMatrix() {
    const matrix = new Float64Array(AXIS_COUNT * AXIS_COUNT);
    for (let i = 0; i < AXIS_COUNT; i += 1) {
        matrix[i * AXIS_COUNT + i] = 1;
    }
    return matrix;
}

function multiplyMatrices(a, b) {
    const result = new Float64Array(AXIS_COUNT * AXIS_COUNT);
    for (let row = 0; row < AXIS_COUNT; row += 1) {
        for (let col = 0; col < AXIS_COUNT; col += 1) {
            let sum = 0;
            for (let k = 0; k < AXIS_COUNT; k += 1) {
                sum += a[row * AXIS_COUNT + k] * b[k * AXIS_COUNT + col];
            }
            result[row * AXIS_COUNT + col] = sum;
        }
    }
    return result;
}

function createPlaneRotationMatrix(axisA, axisB, angle) {
    const matrix = createIdentityMatrix();
    if (!angle) {
        return matrix;
    }

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    matrix[axisA * AXIS_COUNT + axisA] = cos;
    matrix[axisA * AXIS_COUNT + axisB] = -sin;
    matrix[axisB * AXIS_COUNT + axisA] = sin;
    matrix[axisB * AXIS_COUNT + axisB] = cos;

    return matrix;
}

function toColumnMajor(rowMajor) {
    const result = new Float32Array(AXIS_COUNT * AXIS_COUNT);
    for (let row = 0; row < AXIS_COUNT; row += 1) {
        for (let col = 0; col < AXIS_COUNT; col += 1) {
            result[col * AXIS_COUNT + row] = rowMajor[row * AXIS_COUNT + col];
        }
    }
    return result;
}

function extractTopLeft3x3(rowMajor) {
    const result = new Float32Array(9);
    let index = 0;
    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            result[index] = rowMajor[row * AXIS_COUNT + col];
            index += 1;
        }
    }
    return result;
}

function isIdentityMatrix(rowMajor, tolerance = 1e-6) {
    for (let row = 0; row < AXIS_COUNT; row += 1) {
        for (let col = 0; col < AXIS_COUNT; col += 1) {
            const expected = row === col ? 1 : 0;
            const value = rowMajor[row * AXIS_COUNT + col];
            if (Math.abs(value - expected) > tolerance) {
                return false;
            }
        }
    }
    return true;
}

export function composeFourDRotation(angles = {}) {
    let accumulator = createIdentityMatrix();

    for (const { key, axes } of PLANE_SEQUENCE) {
        const angle = Number.isFinite(angles[key]) ? angles[key] : 0;
        if (!angle) {
            continue;
        }
        const rotation = createPlaneRotationMatrix(axes[0], axes[1], angle);
        accumulator = multiplyMatrices(rotation, accumulator);
    }

    const rowMajor = new Float32Array(accumulator);
    const columnMajor = toColumnMajor(accumulator);
    const matrix3 = extractTopLeft3x3(accumulator);
    const planeAngles = new Float32Array(PLANE_SEQUENCE.map(({ key }) => Number.isFinite(angles[key]) ? angles[key] : 0));

    return {
        matrix4: columnMajor,
        matrix3,
        rowMajor,
        planeAngles,
        isIdentity: isIdentityMatrix(accumulator),
        order: PLANE_SEQUENCE.map(({ key }) => key)
    };
}

export function applyRotationMatrix(matrix4, vector) {
    if (!matrix4 || !vector) {
        return null;
    }
    const m = matrix4;
    const v = vector;
    const result = new Float64Array(AXIS_COUNT);

    // matrix is column-major
    result[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3];
    result[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3];
    result[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3];
    result[3] = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3];

    return new Float32Array(result);
}

export const FOUR_D_ROTATION_PLANES = PLANE_SEQUENCE.map(({ key }) => key);
