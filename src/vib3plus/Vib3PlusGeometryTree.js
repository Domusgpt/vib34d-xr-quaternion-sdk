import { GeometryLibrary } from '../geometry/GeometryLibrary.js';

const DEFAULT_LEVELS = [0, 1, 2];
const ZERO_ROTATIONS = Object.freeze({
    rot4dXY: 0,
    rot4dXZ: 0,
    rot4dYZ: 0,
    rot4dXW: 0,
    rot4dYW: 0,
    rot4dZW: 0,
    dimension: 3.5
});

const CORE_ROTATION_BIAS = {
    'hypercube-core': {
        emphasis: ['rot4dXW', 'rot4dYW', 'rot4dZW'],
        description: 'Legacy hypercube pairings with strong W-axis projection'
    },
    'hypersphere-core': {
        emphasis: ['rot4dXY', 'rot4dXZ', 'rot4dYZ'],
        description: 'Balanced spatial rotations suited to hyperspherical shells'
    },
    'hypertetra-core': {
        emphasis: ['rot4dXY', 'rot4dXW', 'rot4dYW'],
        description: 'Facet-aligned tetrahedral cuts through the hyperspace lattice'
    }
};

function clone(value) {
    if (Array.isArray(value)) {
        return value.map(clone);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, clone(val)]));
    }
    return value;
}

export function buildVib3PlusGeometryTree(levels = DEFAULT_LEVELS) {
    const metadata = GeometryLibrary.listGeometryMetadata();
    const validLevels = Array.from(new Set(levels.filter(level => Number.isInteger(level) && level >= 0)));
    validLevels.sort((a, b) => a - b);

    return metadata.map(entry => {
        const variations = validLevels.map(level => {
            const baseParameters = GeometryLibrary.getVariationParameters(entry.index, level);
            return {
                level,
                parameters: {
                    geometry: entry.index,
                    ...clone(baseParameters),
                    ...ZERO_ROTATIONS
                }
            };
        });

        return {
            id: `${entry.baseKey}::${entry.coreKey}`,
            geometryIndex: entry.index,
            displayName: entry.name,
            base: {
                index: entry.baseIndex,
                key: entry.baseKey,
                name: entry.baseName
            },
            core: {
                index: entry.coreIndex,
                key: entry.coreKey,
                name: entry.coreName,
                isLegacy: entry.isLegacyCore,
                rotationBias: CORE_ROTATION_BIAS[entry.coreKey] || null
            },
            variations
        };
    });
}

export function describeVib3PlusGeometry(index) {
    const entry = GeometryLibrary.describeGeometry(index);
    if (!entry) {
        return null;
    }

    const [treeEntry] = buildVib3PlusGeometryTree([0]).filter(node => node.geometryIndex === entry.index);
    if (!treeEntry) {
        return null;
    }

    return treeEntry;
}

export function listVib3PlusCores() {
    return GeometryLibrary.coreVariants.map(variant => ({
        key: variant.key,
        name: variant.name,
        isLegacy: Boolean(variant.legacy),
        rotationBias: CORE_ROTATION_BIAS[variant.key] || null
    }));
}
