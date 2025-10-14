import { ProjectionScenarioParameterValidator } from './ProjectionScenarioValidator.js';

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

const BASE_BLUEPRINT = Object.freeze({
    intensity: 0.52,
    engagementLevel: 0.6,
    biometricStress: 0.18,
    focusVector: { x: 0.48, y: 0.52, depth: 0.34 },
    zones: [
        { id: 'primary', occupancy: 0.58, visibility: 0.82, curvature: 0.42, layeringDepth: 0.26 },
        { id: 'peripheral', occupancy: 0.42, visibility: 0.56, curvature: 0.61, layeringDepth: 0.32 },
        { id: 'support', occupancy: 0.35, visibility: 0.44, curvature: 0.38, layeringDepth: 0.28 }
    ],
    annotations: [
        { id: 'baseline', type: 'note', priority: 0 },
        { id: 'stress-watch', type: 'stress-alert', priority: 1 }
    ]
});

const BASE_CONTEXT = Object.freeze({
    gazeVelocity: 0.38,
    neuralCoherence: 0.48,
    hapticFeedback: 0.32,
    ambientVariance: 0.28,
    gestureIntent: {
        intensity: 0.36,
        vector: { x: 0.51, y: 0.47, z: 0.42 }
    }
});

export const DEFAULT_PROJECTION_SCENARIOS = Object.freeze([
    {
        id: 'focus-handoff',
        name: 'Focus Handoff',
        description: 'Gaze shifts from primary to peripheral halo while gestures intensify.',
        cycleMs: 9000,
        blueprint: {
            ...BASE_BLUEPRINT,
            intensity: 0.46,
            engagementLevel: 0.58
        },
        context: {
            ...BASE_CONTEXT,
            gazeVelocity: 0.4
        },
        modulation: {
            blueprint: {
                focusX: { start: 0.45, end: 0.62, easing: 'ease-in-out' },
                focusY: { start: 0.48, end: 0.38, easing: 'ease-in-out' },
                focusDepth: { start: 0.28, end: 0.46, easing: 'ease-out' },
                intensity: { start: 0.42, end: 0.76, easing: 'ease-in' },
                zoneOccupancy: [
                    { id: 'primary', start: 0.55, end: 0.38, easing: 'ease-out' },
                    { id: 'peripheral', start: 0.32, end: 0.56, easing: 'ease-in' }
                ]
            },
            context: {
                gestureIntensity: { start: 0.35, end: 0.68, easing: 'ease-in-out' },
                neuralCoherence: { start: 0.42, end: 0.6, easing: 'ease-in' }
            }
        },
        anchors: [
            { id: 'entry', label: 'Engage' },
            { id: 'handoff', label: 'Peripheral Handoff' },
            { id: 'stabilize', label: 'Stabilize' }
        ]
    },
    {
        id: 'calm-recovery',
        name: 'Calm Recovery',
        description: 'Stress recovery wave that contracts halo radius and redistributes lobes.',
        cycleMs: 10500,
        blueprint: {
            ...BASE_BLUEPRINT,
            biometricStress: 0.26,
            engagementLevel: 0.52
        },
        context: {
            ...BASE_CONTEXT,
            gazeVelocity: 0.48,
            hapticFeedback: 0.4
        },
        modulation: {
            blueprint: {
                biometricStress: { start: 0.26, end: 0.12, easing: 'ease-out' },
                engagementLevel: { start: 0.48, end: 0.64, easing: 'ease-in' },
                focusDepth: { start: 0.44, end: 0.3, easing: 'ease-in-out' }
            },
            context: {
                gazeVelocity: { start: 0.48, end: 0.24, easing: 'ease-out' },
                hapticFeedback: { start: 0.4, end: 0.22, easing: 'ease-out' },
                gestureIntensity: { start: 0.28, end: 0.18, easing: 'ease-out' }
            },
            composerOptions: { haloFalloff: 0.72 }
        },
        anchors: [
            { id: 'spike', label: 'Stress Spike' },
            { id: 'release', label: 'Release' },
            { id: 'stability', label: 'Stability' }
        ]
    },
    {
        id: 'collaborative-sync',
        name: 'Collaborative Sync',
        description: 'Shared workspace burst blending dual-focus anchors and biometric cadence.',
        cycleMs: 9800,
        blueprint: {
            ...BASE_BLUEPRINT,
            intensity: 0.58,
            focusVector: { x: 0.52, y: 0.44, depth: 0.36 },
            zones: [
                { id: 'primary', occupancy: 0.54, visibility: 0.84, curvature: 0.46, layeringDepth: 0.28 },
                { id: 'collab', occupancy: 0.38, visibility: 0.72, curvature: 0.52, layeringDepth: 0.35 },
                { id: 'ambient', occupancy: 0.31, visibility: 0.4, curvature: 0.34, layeringDepth: 0.24 }
            ],
            annotations: [
                { id: 'collab-anchor', type: 'note', priority: 1 },
                { id: 'biometric-sync', type: 'stress-alert', priority: 2 }
            ]
        },
        context: {
            ...BASE_CONTEXT,
            neuralCoherence: 0.52,
            gestureIntent: {
                intensity: 0.42,
                vector: { x: 0.58, y: 0.46, z: 0.48 }
            }
        },
        modulation: {
            blueprint: {
                intensity: { start: 0.48, end: 0.74, easing: 'ease-in-out' },
                engagementLevel: { start: 0.54, end: 0.7, easing: 'ease-in' },
                zoneOccupancy: [
                    { id: 'collab', start: 0.32, end: 0.58, easing: 'anticipate' },
                    { id: 'ambient', start: 0.28, end: 0.22, easing: 'ease-out' }
                ]
            },
            context: {
                neuralCoherence: { start: 0.48, end: 0.68, easing: 'ease-in' },
                gestureIntensity: { start: 0.34, end: 0.56, easing: 'ease-in-out' },
                gestureX: { start: 0.48, end: 0.62, easing: 'ease-in-out' }
            },
            composerOptions: { gestureWeight: 0.62, biasSmoothing: 0.38 }
        },
        anchors: [
            { id: 'prepare', label: 'Prepare' },
            { id: 'sync', label: 'Synchronize' },
            { id: 'commit', label: 'Commit' }
        ]
    }
]);

const DEFAULT_PACK = Object.freeze({
    id: 'immersive-defaults',
    name: 'Immersive Wearable Defaults',
    description: 'Baseline adaptive projection scenarios tuned for wearable-first collaboration.',
    scenarios: DEFAULT_PROJECTION_SCENARIOS
});

export class ProjectionScenarioCatalog {
    constructor(options = {}) {
        this.scenarios = new Map();
        this.packs = new Map();
        this.validator = options.validator instanceof ProjectionScenarioParameterValidator
            ? options.validator
            : new ProjectionScenarioParameterValidator(options.validatorOptions);

        const includeDefaults = options.includeDefaults ?? true;
        if (includeDefaults) {
            this.registerScenarioPack(deepClone(DEFAULT_PACK));
        }

        if (Array.isArray(options.scenarios)) {
            for (const scenario of options.scenarios) {
                this.registerScenario(scenario);
            }
        }

        if (Array.isArray(options.packs)) {
            for (const pack of options.packs) {
                this.registerScenarioPack(pack);
            }
        }
    }

    cloneScenario(scenario) {
        return deepClone(scenario);
    }

    buildValidationSummary(issues = [], extras = {}) {
        const status = issues.some(issue => issue.severity === 'error')
            ? 'error'
            : (issues.length > 0 ? 'warning' : 'ok');
        return {
            status,
            issueCount: issues.length,
            issues: issues.map(issue => ({ ...issue })),
            updatedAt: new Date().toISOString(),
            ...extras
        };
    }

    decorateScenarioEntry(scenario, issues = []) {
        const stored = deepClone(scenario);
        const metadata = stored.metadata && typeof stored.metadata === 'object'
            ? stored.metadata
            : {};
        metadata.validation = this.buildValidationSummary(issues, {
            scope: 'scenario',
            scenarioId: stored.id,
            packId: metadata.packId ?? null
        });
        stored.metadata = metadata;
        return stored;
    }

    refreshPackValidation(packId, options = {}) {
        const pack = this.packs.get(packId);
        if (!pack) {
            return;
        }
        if (options.ensureMembership && options.scenarioId) {
            if (!pack.scenarios.includes(options.scenarioId)) {
                pack.scenarios.push(options.scenarioId);
            }
        }

        const issues = [];
        for (const scenarioId of pack.scenarios) {
            const scenario = this.scenarios.get(scenarioId);
            if (!scenario) {
                continue;
            }
            const validation = scenario.metadata?.validation;
            if (!validation?.issues) {
                continue;
            }
            for (const issue of validation.issues) {
                issues.push({ ...issue, scenarioId });
            }
        }
        pack.validation = this.buildValidationSummary(issues, {
            scope: 'pack',
            packId,
            scenarioCount: pack.scenarios.length
        });
    }

    registerScenario(descriptor, options = {}) {
        const metadata = descriptor?.metadata && typeof descriptor.metadata === 'object'
            ? descriptor.metadata
            : {};
        const descriptorWithPack = {
            ...descriptor,
            metadata: {
                ...metadata,
                packId: options.packId ?? metadata.packId ?? null
            }
        };

        const { scenario, issues } = this.validator.validateScenario(descriptorWithPack);
        const storedScenario = this.decorateScenarioEntry(scenario, issues);

        this.scenarios.set(storedScenario.id, storedScenario);

        const packId = storedScenario.metadata?.packId;
        if (packId && !options.skipPackValidation) {
            this.refreshPackValidation(packId, {
                ensureMembership: !options.skipPackSync,
                scenarioId: storedScenario.id
            });
        }

        return this.cloneScenario(storedScenario);
    }

    registerScenarioPack(pack) {
        if (!pack || !pack.id) {
            throw new Error('ProjectionScenarioCatalog: pack requires an `id`.');
        }

        const storedPack = {
            id: pack.id,
            name: pack.name || pack.id,
            description: pack.description || '',
            metadata: pack.metadata ? deepClone(pack.metadata) : {},
            scenarios: []
        };

        this.packs.set(storedPack.id, storedPack);

        const scenarios = Array.isArray(pack.scenarios) ? pack.scenarios : [];
        for (const scenario of scenarios) {
            const registered = this.registerScenario({
                ...scenario,
                metadata: {
                    ...(scenario.metadata || {}),
                    packId: pack.id
                }
            }, { packId: pack.id, skipPackValidation: true, skipPackSync: true });
            storedPack.scenarios.push(registered.id);
        }

        this.refreshPackValidation(storedPack.id);
        return deepClone(storedPack);
    }

    listScenarios() {
        return Array.from(this.scenarios.values(), scenario => this.cloneScenario(scenario));
    }

    getScenario(id) {
        const scenario = this.scenarios.get(id);
        return scenario ? this.cloneScenario(scenario) : null;
    }

    listScenarioPacks() {
        return Array.from(this.packs.values(), pack => deepClone(pack));
    }

    getScenarioPack(id) {
        const pack = this.packs.get(id);
        return pack ? deepClone(pack) : null;
    }

    removeScenario(id) {
        const scenario = this.scenarios.get(id);
        const removed = this.scenarios.delete(id);
        if (removed && scenario?.metadata?.packId && this.packs.has(scenario.metadata.packId)) {
            const pack = this.packs.get(scenario.metadata.packId);
            pack.scenarios = pack.scenarios.filter(entryId => entryId !== id);
            this.refreshPackValidation(scenario.metadata.packId);
        }
        return removed;
    }

    applyToSimulator(simulator, options = {}) {
        if (!simulator) {
            return;
        }

        const replaceExisting = options.replaceExisting ?? false;
        if (replaceExisting) {
            for (const scenario of simulator.listScenarios?.() || []) {
                simulator.removeScenario?.(scenario.id);
            }
        }

        for (const scenario of this.scenarios.values()) {
            const existing = simulator.getScenario?.(scenario.id);
            if (existing) {
                continue;
            }
            simulator.registerScenario(scenario);
        }
    }
}

export function createProjectionScenarioCatalog(options = {}) {
    return new ProjectionScenarioCatalog(options);
}

export function createDefaultProjectionScenarioCatalog() {
    return new ProjectionScenarioCatalog();
}
