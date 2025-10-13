import { GeometryLibrary } from '../geometry/GeometryLibrary.js';

const DEFAULT_LEVELS = [0, 1, 2];
const ROTATION_PLANES = Object.freeze([
    'rot4dXY',
    'rot4dXZ',
    'rot4dYZ',
    'rot4dXW',
    'rot4dYW',
    'rot4dZW'
]);
const ROTATION_LEVEL_AMPLITUDES = Object.freeze([0, 0.9, 1.8]);
const ROTATION_NON_EMPHASIS_SCALE = 0.35;
const ROTATION_POLARITY = Object.freeze({
    rot4dXY: 1,
    rot4dXZ: -1,
    rot4dYZ: 1,
    rot4dXW: -1,
    rot4dYW: 1,
    rot4dZW: -1
});
const CORE_DIMENSION_BASE = Object.freeze({
    'hypercube-core': 3.35,
    'hypersphere-core': 3.95,
    'hypertetra-core': 3.75
});
const DIMENSION_LEVEL_STEP = 0.22;

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

function clampDimension(value) {
    return Math.max(3, Math.min(4.5, value));
}

function resolveDimension(coreKey, level) {
    const base = CORE_DIMENSION_BASE[coreKey] ?? 3.5;
    const increment = Math.max(0, Number.isFinite(level) ? level : 0) * DIMENSION_LEVEL_STEP;
    return clampDimension(base + increment);
}

function resolveRotationDefaults(coreKey, level) {
    const emphasisSet = new Set(CORE_ROTATION_BIAS[coreKey]?.emphasis || []);
    const amplitude = ROTATION_LEVEL_AMPLITUDES[Math.min(Math.max(level, 0), ROTATION_LEVEL_AMPLITUDES.length - 1)] || 0;
    const baseMagnitude = amplitude * ROTATION_NON_EMPHASIS_SCALE;

    const rotations = {};
    const planes = ROTATION_PLANES.map((plane, index) => {
        const emphasised = emphasisSet.has(plane);
        const polarity = ROTATION_POLARITY[plane] ?? (index % 2 === 0 ? 1 : -1);
        const weight = emphasised ? 1 : ROTATION_NON_EMPHASIS_SCALE;
        const value = amplitude === 0 ? 0 : polarity * amplitude * weight;
        rotations[plane] = Number.isFinite(value) ? value : 0;
        return {
            plane,
            emphasised,
            polarity,
            value: rotations[plane]
        };
    });

    return {
        rotations,
        profile: {
            coreKey,
            level,
            amplitude,
            baseMagnitude,
            emphasis: Array.from(emphasisSet),
            planes,
            nonEmphasisScale: ROTATION_NON_EMPHASIS_SCALE
        }
    };
}

export function buildVib3PlusGeometryTree(levels = DEFAULT_LEVELS) {
    const metadata = GeometryLibrary.listGeometryMetadata();
    const validLevels = Array.from(new Set(levels.filter(level => Number.isInteger(level) && level >= 0)));
    validLevels.sort((a, b) => a - b);

    return metadata.map(entry => {
        const variations = validLevels.map(level => {
            const baseParameters = GeometryLibrary.getVariationParameters(entry.index, level);
            const { rotations, profile } = resolveRotationDefaults(entry.coreKey, level);
            const dimension = resolveDimension(entry.coreKey, level);
            return {
                level,
                parameters: {
                    geometry: entry.index,
                    geometryBase: entry.baseIndex,
                    geometryCore: entry.coreIndex,
                    ...clone(baseParameters),
                    dimension,
                    ...rotations
                },
                rotationProfile: {
                    ...profile,
                    dimension
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

export function describeVib3PlusGeometry(criteria) {
    const index = GeometryLibrary.resolveGeometryIndex(criteria);
    if (!Number.isInteger(index)) {
        return null;
    }

    const [treeEntry] = buildVib3PlusGeometryTree([0]).filter(node => node.geometryIndex === index);
    if (!treeEntry) {
        return null;
    }

    return treeEntry;
}

export function listVib3PlusCores() {
    return GeometryLibrary.coreVariants.map((variant, index) => ({
        index,
        key: variant.key,
        name: variant.name,
        isLegacy: Boolean(variant.legacy),
        rotationBias: CORE_ROTATION_BIAS[variant.key] || null
    }));
}

export function findVib3PlusGeometry(criteria, levels = DEFAULT_LEVELS) {
    const index = GeometryLibrary.resolveGeometryIndex(criteria);
    if (!Number.isInteger(index)) {
        return null;
    }

    const tree = buildVib3PlusGeometryTree(levels);
    return tree.find(node => node.geometryIndex === index) || null;
}
