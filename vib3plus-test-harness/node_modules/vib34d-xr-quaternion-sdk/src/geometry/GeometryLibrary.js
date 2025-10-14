/**
 * VIB3 Geometry Library
 * 8 geometric types with 4D polytopal mathematics integration
 * WebGL 1.0 compatible shaders only
 */

const BASE_GEOMETRIES = [
    { key: 'tetrahedron', name: 'TETRAHEDRON' },
    { key: 'hypercube', name: 'HYPERCUBE' },
    { key: 'sphere', name: 'SPHERE' },
    { key: 'torus', name: 'TORUS' },
    { key: 'klein-bottle', name: 'KLEIN BOTTLE' },
    { key: 'fractal', name: 'FRACTAL' },
    { key: 'wave', name: 'WAVE' },
    { key: 'crystal', name: 'CRYSTAL' }
];

const CORE_VARIANTS = [
    { key: 'hypercube-core', name: 'HYPERCUBE CORE', suffix: '', legacy: true },
    { key: 'hypersphere-core', name: 'HYPERSPHERE CORE' },
    { key: 'hypertetra-core', name: 'HYPERTETRA CORE' }
];

const BASE_INDEX_BY_KEY = new Map(BASE_GEOMETRIES.map((entry, index) => [entry.key, index]));
const CORE_INDEX_BY_KEY = new Map(CORE_VARIANTS.map((entry, index) => [entry.key, index]));

export class GeometryLibrary {
    static get baseGeometries() {
        return BASE_GEOMETRIES;
    }

    static get coreVariants() {
        return CORE_VARIANTS;
    }

    static baseIndexFromKey(key) {
        if (typeof key !== 'string') {
            return null;
        }
        const lower = key.trim().toLowerCase();
        for (const [candidate, index] of BASE_INDEX_BY_KEY.entries()) {
            if (candidate === key || candidate === lower) {
                return index;
            }
        }
        return null;
    }

    static coreIndexFromKey(key) {
        if (typeof key !== 'string') {
            return null;
        }
        const lower = key.trim().toLowerCase();
        for (const [candidate, index] of CORE_INDEX_BY_KEY.entries()) {
            if (candidate === key || candidate === lower) {
                return index;
            }
        }
        return null;
    }

    static normalizeGeometryIndex(index) {
        const total = BASE_GEOMETRIES.length * CORE_VARIANTS.length;
        if (!total) {
            return null;
        }
        if (!Number.isFinite(index)) {
            return null;
        }
        const normalized = Math.trunc(index);
        return ((normalized % total) + total) % total;
    }

    static encodeGeometryIndex(baseIndex, coreIndex = 0) {
        const baseCount = BASE_GEOMETRIES.length;
        const coreCount = CORE_VARIANTS.length;
        if (!baseCount || !coreCount) {
            return null;
        }
        if (!Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= baseCount) {
            return null;
        }
        if (!Number.isInteger(coreIndex) || coreIndex < 0 || coreIndex >= coreCount) {
            return null;
        }
        return coreIndex * baseCount + baseIndex;
    }

    static resolveGeometryIndex(criteria = {}) {
        if (Number.isInteger(criteria)) {
            return this.normalizeGeometryIndex(criteria);
        }

        const { geometry, baseIndex, baseKey, coreIndex, coreKey } = criteria;

        if (Number.isInteger(geometry)) {
            return this.normalizeGeometryIndex(geometry);
        }

        let resolvedBase = Number.isInteger(baseIndex) ? baseIndex : this.baseIndexFromKey(baseKey);
        if (!Number.isInteger(resolvedBase)) {
            return null;
        }

        let resolvedCore = Number.isInteger(coreIndex) ? coreIndex : this.coreIndexFromKey(coreKey);
        if (!Number.isInteger(resolvedCore)) {
            resolvedCore = 0;
        }

        return this.encodeGeometryIndex(resolvedBase, resolvedCore);
    }

    static describeByComponents(criteria = {}) {
        const index = this.resolveGeometryIndex(criteria);
        if (!Number.isInteger(index)) {
            return null;
        }
        return this.describeGeometry(index);
    }

    static getGeometryNames() {
        const hypersphere = BASE_GEOMETRIES.map(({ name }) => `${name} • ${CORE_VARIANTS[1].name}`);
        const hypertetra = BASE_GEOMETRIES.map(({ name }) => `${name} • ${CORE_VARIANTS[2].name}`);

        return [
            ...BASE_GEOMETRIES.map(({ name }) => name),
            ...hypersphere,
            ...hypertetra
        ];
    }

    static getGeometryName(type) {
        const names = this.getGeometryNames();
        return names[type] || 'UNKNOWN';
    }

    static describeGeometry(index) {
        const baseCount = BASE_GEOMETRIES.length;
        if (baseCount === 0) {
            return null;
        }

        const normalizedIndex = ((index % (baseCount * CORE_VARIANTS.length)) + (baseCount * CORE_VARIANTS.length))
            % (baseCount * CORE_VARIANTS.length);

        const baseIndex = normalizedIndex % baseCount;
        const coreIndex = Math.floor(normalizedIndex / baseCount);

        const base = BASE_GEOMETRIES[baseIndex];
        const core = CORE_VARIANTS[coreIndex] || CORE_VARIANTS[0];

        return {
            index: normalizedIndex,
            name: this.getGeometryName(normalizedIndex),
            baseIndex,
            baseKey: base.key,
            baseName: base.name,
            coreIndex,
            coreKey: core.key,
            coreName: core.name,
            isLegacyCore: Boolean(core.legacy)
        };
    }

    static listGeometryMetadata() {
        const total = BASE_GEOMETRIES.length * CORE_VARIANTS.length;
        const entries = [];
        for (let index = 0; index < total; index += 1) {
            entries.push(this.describeGeometry(index));
        }
        return entries;
    }
    
    /**
     * Get variation parameters for specific geometry and level
     */
    static getVariationParameters(geometryType, level) {
        const baseCount = BASE_GEOMETRIES.length;
        if (!baseCount) {
            return {};
        }

        const normalizedIndex = ((geometryType % (baseCount * CORE_VARIANTS.length))
            + (baseCount * CORE_VARIANTS.length)) % (baseCount * CORE_VARIANTS.length);

        const baseType = normalizedIndex % baseCount;
        const coreType = Math.floor(normalizedIndex / baseCount);

        const baseParams = {
            gridDensity: 8 + (level * 4),
            morphFactor: 0.5 + (level * 0.3),
            chaos: level * 0.15,
            speed: 0.8 + (level * 0.2),
            hue: (baseType * 45 + level * 15) % 360
        };

        // Geometry-specific adjustments
        switch (baseType) {
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

        // Core-specific adjustments (0 = legacy hypercube, 1 = hypersphere, 2 = hypertetra)
        if (coreType === 1) {
            baseParams.gridDensity *= 1.1;
            baseParams.morphFactor *= 1.25;
            baseParams.chaos *= 1.2;
            baseParams.speed *= 0.95;
        } else if (coreType === 2) {
            baseParams.gridDensity *= 0.95;
            baseParams.morphFactor *= 1.35;
            baseParams.chaos *= 1.15;
            baseParams.speed *= 1.1;
        }

        return baseParams;
    }
}
