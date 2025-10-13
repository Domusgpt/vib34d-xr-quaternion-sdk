import { ParameterManager, ROTATION_PLANE_KEYS } from '../core/Parameters.js';
import { QuaternionFieldService } from '../core/quaternions/QuaternionFieldService.js';
import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { GeometryLibrary } from '../geometry/GeometryLibrary.js';
import {
    buildVib3PlusGeometryTree,
    describeVib3PlusGeometry,
    listVib3PlusCores
} from './Vib3PlusGeometryTree.js';

function clone(value) {
    if (Array.isArray(value)) {
        return value.map(clone);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, clone(val)]));
    }
    return value;
}

function extractRotationState(manager) {
    const state = {};
    for (const plane of ROTATION_PLANE_KEYS) {
        state[plane] = manager.getParameter(plane);
    }
    return state;
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

    getRotationState() {
        return extractRotationState(this.parameterManager);
    }

    setRotationPlane(plane, value, { propagate = true, reason = 'rotation-plane' } = {}) {
        if (!ROTATION_PLANE_KEYS.includes(plane)) {
            throw new Error(`Unknown rotation plane "${plane}"`);
        }

        this.parameterManager.setRotationPlane(plane, value);

        if (propagate) {
            this.broadcastParameters({ [plane]: this.parameterManager.getParameter(plane) }, {
                reason,
                rotationState: this.getRotationState()
            });
        }

        return this.parameterManager.getParameter(plane);
    }

    applyRotationProfile(profile, { propagate = true, reason = 'rotation-profile' } = {}) {
        const applied = this.parameterManager.applyRotationProfile(profile);
        if (!applied) {
            return null;
        }

        const rotationState = this.getRotationState();
        if (propagate) {
            const profileContext = profile && typeof profile === 'object'
                ? (profile.rotationProfile || profile.rotations || profile)
                : profile;
            this.broadcastParameters(rotationState, {
                reason,
                rotationProfile: profileContext,
                rotationState
            });
        }

        return rotationState;
    }

    applyRotationDeltas(deltas, { propagate = true, reason = 'rotation-delta' } = {}) {
        const applied = this.parameterManager.applyRotationDeltas(deltas);
        if (!applied) {
            return null;
        }

        const rotationState = this.getRotationState();
        if (propagate) {
            this.broadcastParameters(rotationState, {
                reason,
                rotationDeltas: { ...deltas },
                rotationState
            });
        }

        return rotationState;
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
        for (const [name, system] of Object.entries(this.systems)) {
            if (!system) {
                continue;
            }

            if (typeof system.batchUpdate === 'function') {
                try {
                    system.batchUpdate(updates, { ...context, systemName: name });
                    continue;
                } catch (error) {
                    console.warn(`[Vib3PlusEnvironment] batchUpdate failed for ${name}`, error);
                }
            }

            if (typeof system.updateParameters === 'function') {
                try {
                    system.updateParameters(updates, { ...context, systemName: name });
                    continue;
                } catch (error) {
                    console.warn(`[Vib3PlusEnvironment] updateParameters failed for ${name}`, error);
                }
            }

            for (const [param, value] of Object.entries(updates)) {
                if (typeof system.updateParameter === 'function') {
                    try {
                        system.updateParameter(param, value, { ...context, systemName: name });
                    } catch (error) {
                        console.warn(`[Vib3PlusEnvironment] updateParameter failed for ${name}:${param}`, error);
                    }
                }
            }
        }
    }
}

export default function createVib3PlusEnvironment(options = {}) {
    return new Vib3PlusEnvironment(options);
}
