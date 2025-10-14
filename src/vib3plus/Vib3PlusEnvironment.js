import { ParameterManager } from '../core/Parameters.js';
import { QuaternionFieldService } from '../core/quaternions/QuaternionFieldService.js';
import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { GeometryLibrary } from '../geometry/GeometryLibrary.js';
import {
    buildVib3PlusGeometryTree,
    describeVib3PlusGeometry,
    listVib3PlusCores
} from './Vib3PlusGeometryTree.js';
import { composeFourDRotation } from '../math/rotations/FourDRotationComposer.js';

function clone(value) {
    if (Array.isArray(value)) {
        return value.map(clone);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, clone(val)]));
    }
    return value;
}

export class Vib3PlusEnvironment {
    constructor(options = {}) {
        const {
            geometryLevels,
            parameterManager,
            quaternionService,
            quaternionOptions,
            systems = {},
            defaultGeometryIndex
        } = options;

        this.geometryTree = buildVib3PlusGeometryTree(geometryLevels);
        this.parameterManager = parameterManager || new ParameterManager();
        this.quaternionService = quaternionService
            || new QuaternionFieldService({
                ...(quaternionOptions || {})
            });
        this.systems = { ...systems };
        this.synchronizer = null;
        this.currentGeometryIndex = Number.isInteger(defaultGeometryIndex)
            ? defaultGeometryIndex
            : this.parameterManager.getParameter('geometry') ?? 0;

        this.applyGeometryIndex(this.currentGeometryIndex, { propagate: false });
    }

    getGeometryTree() {
        return clone(this.geometryTree);
    }

    listCores() {
        return listVib3PlusCores();
    }

    describeGeometry(criteria) {
        return describeVib3PlusGeometry(criteria);
    }

    resolveGeometryIndex(criteria) {
        if (criteria === undefined || criteria === null) {
            return GeometryLibrary.resolveGeometryIndex(this.currentGeometryIndex);
        }
        return GeometryLibrary.resolveGeometryIndex(criteria);
    }

    getGeometryNode(criteria = undefined) {
        const index = this.resolveGeometryIndex(criteria);
        if (!Number.isInteger(index)) {
            return null;
        }
        return this.geometryTree.find(entry => entry.geometryIndex === index) || null;
    }

    getCurrentGeometry() {
        const node = this.getGeometryNode();
        return node ? clone(node) : null;
    }

    getRotationParameters() {
        if (!this.parameterManager) {
            return null;
        }
        const rot4dXY = this.parameterManager.getParameter('rot4dXY');
        const rot4dXZ = this.parameterManager.getParameter('rot4dXZ');
        const rot4dYZ = this.parameterManager.getParameter('rot4dYZ');
        const rot4dXW = this.parameterManager.getParameter('rot4dXW');
        const rot4dYW = this.parameterManager.getParameter('rot4dYW');
        const rot4dZW = this.parameterManager.getParameter('rot4dZW');

        if ([rot4dXY, rot4dXZ, rot4dYZ, rot4dXW, rot4dYW, rot4dZW]
            .some(value => !Number.isFinite(value))) {
            return null;
        }

        return { rot4dXY, rot4dXZ, rot4dYZ, rot4dXW, rot4dYW, rot4dZW };
    }

    getRotationProfile({ geometry, level } = {}) {
        const node = this.getGeometryNode(geometry);
        if (!node) {
            return null;
        }

        const variation = typeof level === 'number'
            ? node.variations.find(entry => entry.level === level)
            : node.variations[0];

        if (!variation || !variation.rotationProfile) {
            return null;
        }

        return clone(variation.rotationProfile);
    }

    attachSystems(systems = {}) {
        this.systems = {
            ...this.systems,
            ...systems
        };
        return this;
    }

    createSynchronizer(bridge, options = {}) {
        if (!bridge) {
            throw new Error('Vib3PlusEnvironment.createSynchronizer requires a SensoryInputBridge instance');
        }
        if (this.synchronizer) {
            this.synchronizer.stop?.();
        }
        this.synchronizer = new ShaderQuaternionSynchronizer({
            bridge,
            systems: this.systems,
            quaternionService: this.quaternionService,
            ...(options || {})
        });
        this.synchronizer.start?.();
        return this.synchronizer;
    }

    applyGeometryIndex(index, { level = 0, propagate = true } = {}) {
        const node = this.geometryTree.find(entry => entry.geometryIndex === index);
        if (!node) {
            throw new Error(`Unknown geometry index ${index}`);
        }
        return this.applyGeometryNode(node, { level, propagate });
    }

    applyGeometryComponents(components, { level = 0, propagate = true } = {}) {
        const node = this.getGeometryNode(components);
        if (!node) {
            throw new Error('Unknown geometry components provided to Vib3PlusEnvironment.applyGeometryComponents');
        }
        return this.applyGeometryNode(node, { level, propagate });
    }

    applyGeometryNode(node, { level = 0, propagate = true } = {}) {
        const variation = node.variations.find(entry => entry.level === level) || node.variations[0];
        if (!variation) {
            return null;
        }

        this.currentGeometryIndex = node.geometryIndex;
        this.parameterManager.setParameters({
            geometry: node.geometryIndex,
            ...variation.parameters
        });

        if (propagate) {
            this.broadcastParameters(variation.parameters, {
                reason: 'geometry-change',
                geometryNode: clone(node),
                variationLevel: variation.level,
                rotationProfile: variation.rotationProfile ? clone(variation.rotationProfile) : null
            });
        }

        return {
            node: clone(node),
            variation: clone(variation)
        };
    }

    broadcastParameters(params = {}, context = {}) {
        const updates = { ...params, geometry: this.parameterManager.getParameter('geometry') };
        const rotationParameters = this.getRotationParameters();
        const rotationUniforms = rotationParameters
            ? composeFourDRotation(rotationParameters)
            : null;
        for (const [name, system] of Object.entries(this.systems)) {
            if (!system) {
                continue;
            }

            if (typeof system.batchUpdate === 'function') {
                try {
                    system.batchUpdate(updates, this.extendContext(context, rotationUniforms, name));
                    continue;
                } catch (error) {
                    console.warn(`[Vib3PlusEnvironment] batchUpdate failed for ${name}`, error);
                }
            }

            if (typeof system.updateParameters === 'function') {
                try {
                    system.updateParameters(updates, this.extendContext(context, rotationUniforms, name));
                    continue;
                } catch (error) {
                    console.warn(`[Vib3PlusEnvironment] updateParameters failed for ${name}`, error);
                }
            }

            for (const [param, value] of Object.entries(updates)) {
                if (typeof system.updateParameter === 'function') {
                    try {
                        system.updateParameter(param, value, this.extendContext(context, rotationUniforms, name));
                    } catch (error) {
                        console.warn(`[Vib3PlusEnvironment] updateParameter failed for ${name}:${param}`, error);
                    }
                }
            }
        }
    }

    extendContext(context, rotationUniforms, systemName) {
        if (!rotationUniforms) {
            return { ...context, systemName };
        }
        return {
            ...context,
            systemName,
            rotationUniforms
        };
    }
}

export default function createVib3PlusEnvironment(options = {}) {
    return new Vib3PlusEnvironment(options);
}
