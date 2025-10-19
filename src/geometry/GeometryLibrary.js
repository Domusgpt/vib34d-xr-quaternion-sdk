const EUCLIDEAN_NORMALIZER = (vertex) => {
    const length = Math.hypot(...vertex);
    return length === 0 ? vertex.map(() => 0) : vertex.map(value => value / length);
};

function generateSimplexVertices() {
    const raw = [
        [1, 1, 1, 1],
        [1, -1, -1, -1],
        [-1, 1, -1, -1],
        [-1, -1, 1, -1],
        [-1, -1, -1, 1]
    ];
    return raw.map(EUCLIDEAN_NORMALIZER);
}

function generateSimplexEdges(vertexCount) {
    const edges = [];
    for (let i = 0; i < vertexCount; i += 1) {
        for (let j = i + 1; j < vertexCount; j += 1) {
            edges.push([i, j]);
        }
    }
    return edges;
}

function generateHypercubeVertices() {
    const vertices = [];
    for (let x = -1; x <= 1; x += 2) {
        for (let y = -1; y <= 1; y += 2) {
            for (let z = -1; z <= 1; z += 2) {
                for (let w = -1; w <= 1; w += 2) {
                    vertices.push([x, y, z, w]);
                }
            }
        }
    }
    return vertices.map(EUCLIDEAN_NORMALIZER);
}

function generateHypercubeEdges(vertices) {
    const edges = [];
    for (let i = 0; i < vertices.length; i += 1) {
        for (let j = i + 1; j < vertices.length; j += 1) {
            const diff = vertices[i].reduce((count, value, index) =>
                count + (Math.abs(value - vertices[j][index]) > 1e-6 ? 1 : 0), 0);
            if (diff === 1) {
                edges.push([i, j]);
            }
        }
    }
    return edges;
}

function generateCrossPolytopeVertices() {
    const vertices = [];
    for (let axis = 0; axis < 4; axis += 1) {
        const base = [0, 0, 0, 0];
        base[axis] = 1;
        vertices.push([...base]);
        base[axis] = -1;
        vertices.push([...base]);
    }
    return vertices;
}

function generateCrossPolytopeEdges(vertices) {
    const edges = [];
    for (let i = 0; i < vertices.length; i += 1) {
        for (let j = i + 1; j < vertices.length; j += 1) {
            const dot = vertices[i].reduce((acc, value, index) => acc + value * vertices[j][index], 0);
            if (dot > -0.999) {
                edges.push([i, j]);
            }
        }
    }
    return edges;
}

function generate24CellVertices() {
    const vertices = [];
    const values = [-1, 1];
    for (let i = 0; i < 4; i += 1) {
        for (let j = i + 1; j < 4; j += 1) {
            for (const a of values) {
                for (const b of values) {
                    const vertex = [0, 0, 0, 0];
                    vertex[i] = a;
                    vertex[j] = b;
                    vertices.push(EUCLIDEAN_NORMALIZER(vertex));
                }
            }
        }
    }
    return vertices;
}

function generate24CellEdges(vertices) {
    const edges = [];
    for (let i = 0; i < vertices.length; i += 1) {
        for (let j = i + 1; j < vertices.length; j += 1) {
            const distanceSq = vertices[i].reduce((acc, value, index) => {
                const delta = value - vertices[j][index];
                return acc + delta * delta;
            }, 0);
            if (distanceSq > 0.5 && distanceSq < 2.1) {
                edges.push([i, j]);
            }
        }
    }
    return edges;
}

function freezePolychoron(definition) {
    return Object.freeze({
        ...definition,
        vertices: definition.vertices ? definition.vertices.map(vertex => Object.freeze([...vertex])) : null,
        edges: definition.edges ? definition.edges.map(edge => Object.freeze([...edge])) : null,
        metadata: Object.freeze({ ...(definition.metadata || {}) })
    });
}

const POLYCHORA_DEFINITIONS = new Map([
    ['5-cell', freezePolychoron({
        id: '5-cell',
        name: '5-Cell',
        schlafli: '{3,3,3}',
        vertices: generateSimplexVertices(),
        edges: generateSimplexEdges(5),
        metadata: { cells: 5, faces: 10, edges: 10, vertices: 5, dual: '5-cell' }
    })],
    ['tesseract', freezePolychoron({
        id: 'tesseract',
        name: 'Tesseract',
        schlafli: '{4,3,3}',
        vertices: generateHypercubeVertices(),
        edges: null,
        metadata: { cells: 8, faces: 24, edges: 32, vertices: 16, dual: '16-cell' }
    })],
    ['16-cell', freezePolychoron({
        id: '16-cell',
        name: '16-Cell',
        schlafli: '{3,3,4}',
        vertices: generateCrossPolytopeVertices(),
        edges: null,
        metadata: { cells: 16, faces: 32, edges: 24, vertices: 8, dual: 'tesseract' }
    })],
    ['24-cell', freezePolychoron({
        id: '24-cell',
        name: '24-Cell',
        schlafli: '{3,4,3}',
        vertices: generate24CellVertices(),
        edges: null,
        metadata: { cells: 24, faces: 96, edges: 96, vertices: 24, dual: '24-cell' }
    })],
    ['120-cell', freezePolychoron({
        id: '120-cell',
        name: '120-Cell',
        schlafli: '{5,3,3}',
        vertices: null,
        edges: null,
        metadata: { cells: 120, faces: 720, edges: 1200, vertices: 600, dual: '600-cell' }
    })],
    ['600-cell', freezePolychoron({
        id: '600-cell',
        name: '600-Cell',
        schlafli: '{3,3,5}',
        vertices: null,
        edges: null,
        metadata: { cells: 600, faces: 1200, edges: 720, vertices: 120, dual: '120-cell' }
    })]
]);

/**
 * VIB3 Geometry Library
 * 8 geometric types with 4D polytopal mathematics integration
 * WebGL 1.0 compatible shaders only
 */

export class GeometryLibrary {
    static getGeometryNames() {
        return [
            'TETRAHEDRON',
            'HYPERCUBE',
            'SPHERE',
            'TORUS',
            'KLEIN BOTTLE',
            'FRACTAL',
            'WAVE',
            'CRYSTAL'
        ];
    }

    static getGeometryName(type) {
        const names = this.getGeometryNames();
        return names[type] || 'UNKNOWN';
    }

    static listPolychora() {
        return Array.from(POLYCHORA_DEFINITIONS.keys());
    }

    static getPolychoron(identifier) {
        if (typeof identifier === 'number') {
            const keys = this.listPolychora();
            return POLYCHORA_DEFINITIONS.get(keys[identifier]) || null;
        }
        if (typeof identifier === 'string') {
            return POLYCHORA_DEFINITIONS.get(identifier) || null;
        }
        return null;
    }

    static getPolychoronMetadata(identifier) {
        const entry = this.getPolychoron(identifier);
        return entry ? entry.metadata : null;
    }

    static createPolychoronVertexBuffer(identifier) {
        const entry = this.getPolychoron(identifier);
        if (!entry?.vertices) {
            return null;
        }
        return new Float32Array(entry.vertices.flat());
    }

    static getPolychoronEdgeIndexBuffer(identifier) {
        const entry = this.getPolychoron(identifier);
        if (!entry) {
            return null;
        }
        let edges = entry.edges;
        if (!edges && entry.vertices) {
            if (entry.id === 'tesseract') {
                edges = generateHypercubeEdges(entry.vertices);
            } else if (entry.id === '16-cell') {
                edges = generateCrossPolytopeEdges(entry.vertices);
            } else if (entry.id === '24-cell') {
                edges = generate24CellEdges(entry.vertices);
            }
        }
        return edges ? new Uint16Array(edges.flat()) : null;
    }

    /**
     * Get variation parameters for specific geometry and level
     */
    static getVariationParameters(geometryType, level) {
        const baseParams = {
            gridDensity: 8 + (level * 4),
            morphFactor: 0.5 + (level * 0.3),
            chaos: level * 0.15,
            speed: 0.8 + (level * 0.2),
            hue: (geometryType * 45 + level * 15) % 360
        };

        // Geometry-specific adjustments
        switch (geometryType) {
            case 0: // Tetrahedron
                baseParams.gridDensity *= 1.2;
                break;
            case 1: // Hypercube
                baseParams.morphFactor *= 0.8;
                break;
            case 2: // Sphere
                baseParams.chaos *= 1.5;
                break;
            case 3: // Torus
                baseParams.speed *= 1.3;
                break;
            case 4: // Klein Bottle
                baseParams.gridDensity *= 0.7;
                baseParams.morphFactor *= 1.4;
                break;
            case 5: // Fractal
                baseParams.gridDensity *= 0.5;
                baseParams.chaos *= 2.0;
                break;
            case 6: // Wave
                baseParams.speed *= 1.8;
                baseParams.chaos *= 0.5;
                break;
            case 7: // Crystal
                baseParams.gridDensity *= 1.5;
                baseParams.morphFactor *= 0.6;
                break;
        }

        return baseParams;
    }
}