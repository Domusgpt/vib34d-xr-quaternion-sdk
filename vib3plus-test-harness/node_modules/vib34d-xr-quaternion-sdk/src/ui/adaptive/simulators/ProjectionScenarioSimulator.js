import { composeProjectionField } from '../renderers/ProjectionFieldComposer.js';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
    const cast = Number(value);
    return Number.isFinite(cast) ? cast : fallback;
}

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

export function normalizeProjectionScenarioDescriptor(descriptor = {}) {
    if (!descriptor.id) {
        throw new Error('ProjectionScenarioSimulator: scenario descriptor requires an `id`.');
    }
    const cycleMs = Math.max(1000, toNumber(descriptor.cycleMs, 8000));
    return {
        id: descriptor.id,
        name: descriptor.name || descriptor.id,
        description: descriptor.description || '',
        cycleMs,
        blueprint: descriptor.blueprint ? deepClone(descriptor.blueprint) : null,
        context: descriptor.context ? deepClone(descriptor.context) : {},
        modulation: descriptor.modulation || {},
        metadata: descriptor.metadata || {},
        anchors: descriptor.anchors || []
    };
}

function applyRange(value, modulation, progress) {
    if (!modulation) return value;
    const start = toNumber(modulation.start, value);
    const end = toNumber(modulation.end, value);
    const easing = modulation.easing || 'linear';
    const eased = ease(progress, easing);
    return start + (end - start) * eased;
}

function ease(t, easing) {
    const clamped = clamp(t, 0, 1);
    switch (easing) {
        case 'ease-in':
            return Math.pow(clamped, 2);
        case 'ease-out':
            return 1 - Math.pow(1 - clamped, 2);
        case 'anticipate':
            return Math.pow(clamped, 2) * ((2 + 1) * clamped - 2);
        case 'ease-in-out':
            return clamped < 0.5
                ? 2 * clamped * clamped
                : -1 + (4 - 2 * clamped) * clamped;
        default:
            return clamped;
    }
}

function mixBlueprint(baseBlueprint = {}, modulation = {}, progress = 0) {
    const blueprint = deepClone(baseBlueprint);
    blueprint.intensity = clamp(applyRange(toNumber(baseBlueprint.intensity, 0.5), modulation.intensity, progress), 0, 1);
    blueprint.engagementLevel = clamp(applyRange(toNumber(baseBlueprint.engagementLevel, 0.4), modulation.engagementLevel, progress), 0, 1);
    blueprint.biometricStress = clamp(applyRange(toNumber(baseBlueprint.biometricStress, 0.2), modulation.biometricStress, progress), 0, 1);

    const focus = blueprint.focusVector || { x: 0.5, y: 0.5, depth: 0.3 };
    blueprint.focusVector = {
        x: clamp(applyRange(focus.x, modulation.focusX, progress), 0, 1),
        y: clamp(applyRange(focus.y, modulation.focusY, progress), 0, 1),
        depth: clamp(applyRange(focus.depth, modulation.focusDepth, progress), 0, 1)
    };

    const zones = Array.isArray(blueprint.zones) ? blueprint.zones : [];
    if (Array.isArray(modulation.zoneOccupancy)) {
        for (const zoneMod of modulation.zoneOccupancy) {
            const zone = zones.find(item => item.id === zoneMod.id);
            if (zone) {
                zone.occupancy = clamp(applyRange(toNumber(zone.occupancy, 0.4), zoneMod, progress), 0, 1);
            }
        }
    }

    return blueprint;
}

function mixContext(baseContext = {}, modulation = {}, progress = 0) {
    const context = deepClone(baseContext);
    context.engagementLevel = clamp(applyRange(toNumber(baseContext.engagementLevel, 0.4), modulation.engagementLevel, progress), 0, 1);
    context.gazeVelocity = clamp(applyRange(toNumber(baseContext.gazeVelocity, 0.35), modulation.gazeVelocity, progress), 0, 1);
    context.neuralCoherence = clamp(applyRange(toNumber(baseContext.neuralCoherence, 0.45), modulation.neuralCoherence, progress), 0, 1);
    context.hapticFeedback = clamp(applyRange(toNumber(baseContext.hapticFeedback, 0.3), modulation.hapticFeedback, progress), 0, 1);

    const gestureVector = baseContext.gestureIntent?.vector || { x: 0.5, y: 0.5, z: 0.4 };
    const intensity = toNumber(baseContext.gestureIntent?.intensity, 0.3);
    context.gestureIntent = {
        intensity: clamp(applyRange(intensity, modulation.gestureIntensity, progress), 0, 1),
        vector: {
            x: clamp(applyRange(gestureVector.x, modulation.gestureX, progress), 0, 1),
            y: clamp(applyRange(gestureVector.y, modulation.gestureY, progress), 0, 1),
            z: clamp(applyRange(gestureVector.z, modulation.gestureZ, progress), 0, 1)
        }
    };

    return context;
}

export class ProjectionScenarioSimulator {
    constructor(options = {}) {
        this.scenarios = new Map();
        this.activeScenarioId = null;
        this.lastResult = null;
        this.lastAdaptiveState = null;
        this.options = { autoStart: options.autoStart ?? true };
        this.composer = options.composer || null;
        this.listeners = new Map();
    }

    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(listener);
        return () => this.listeners.get(event)?.delete(listener);
    }

    emit(event, payload) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;
        for (const listener of listeners) {
            listener(payload);
        }
    }

    registerScenario(descriptor) {
        const scenario = normalizeProjectionScenarioDescriptor(descriptor);
        this.scenarios.set(scenario.id, scenario);
        if (!this.activeScenarioId) {
            this.activeScenarioId = scenario.id;
            this.emit('scenario:activated', scenario);
        }
        return scenario;
    }

    removeScenario(id) {
        if (!this.scenarios.has(id)) {
            return false;
        }
        const wasActive = this.activeScenarioId === id;
        this.scenarios.delete(id);
        if (wasActive) {
            const next = this.scenarios.keys().next();
            this.activeScenarioId = next.done ? null : next.value;
            if (this.activeScenarioId) {
                this.emit('scenario:activated', this.scenarios.get(this.activeScenarioId));
            }
        }
        return true;
    }

    listScenarios() {
        return Array.from(this.scenarios.values()).map(entry => deepClone(entry));
    }

    getScenario(id) {
        const scenario = this.scenarios.get(id);
        return scenario ? deepClone(scenario) : null;
    }

    setActiveScenario(id) {
        if (!this.scenarios.has(id)) {
            throw new Error(`ProjectionScenarioSimulator: unknown scenario '${id}'.`);
        }
        this.activeScenarioId = id;
        this.emit('scenario:activated', this.scenarios.get(id));
        return this.getScenario(id);
    }

    getActiveScenario() {
        return this.activeScenarioId ? this.getScenario(this.activeScenarioId) : null;
    }

    observeAdaptiveState(state) {
        this.lastAdaptiveState = state ? deepClone(state) : null;
    }

    step(options = {}) {
        if (!this.activeScenarioId) {
            return null;
        }
        const scenario = this.scenarios.get(this.activeScenarioId);
        if (!scenario) {
            return null;
        }
        const now = options.timestamp || Date.now();
        const cycleMs = Math.max(1000, scenario.cycleMs);
        const progress = (now % cycleMs) / cycleMs;

        const baseBlueprint = scenario.blueprint || this.lastAdaptiveState?.blueprint || {};
        const baseContext = scenario.context || this.lastAdaptiveState?.context || {};

        const blueprint = mixBlueprint(baseBlueprint, scenario.modulation.blueprint || {}, progress);
        const context = mixContext(baseContext, scenario.modulation.context || {}, progress);

        const composition = this.compose(blueprint, context, scenario.modulation.composerOptions);
        const anchors = scenario.anchors.map(anchor => ({ ...anchor, progress }));

        this.lastResult = {
            id: scenario.id,
            name: scenario.name,
            description: scenario.description,
            progress,
            cycleMs,
            blueprint,
            context,
            composition,
            anchors
        };

        this.emit('scenario:frame', this.lastResult);
        return this.lastResult;
    }

    compose(blueprint, context = {}, composerOptions = {}) {
        if (this.composer && typeof this.composer.compose === 'function') {
            return this.composer.compose(blueprint, context, composerOptions);
        }
        return composeProjectionField(blueprint, context, composerOptions);
    }

    getLastResult() {
        return this.lastResult ? deepClone(this.lastResult) : null;
    }
}

