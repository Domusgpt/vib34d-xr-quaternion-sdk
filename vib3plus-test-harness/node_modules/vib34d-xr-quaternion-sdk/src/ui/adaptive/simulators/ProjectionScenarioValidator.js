import { normalizeProjectionScenarioDescriptor } from './ProjectionScenarioSimulator.js';

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
    const cast = Number(value);
    return Number.isFinite(cast) ? cast : fallback;
}

function clamp(value, min = 0, max = 1) {
    const numeric = toNumber(value, min);
    return Math.min(max, Math.max(min, numeric));
}

function pushIssue(issues, issue) {
    issues.push({
        code: issue.code,
        path: issue.path,
        message: issue.message,
        severity: issue.severity || 'warning'
    });
}

const DEFAULT_BLUEPRINT = Object.freeze({
    intensity: 0.5,
    engagementLevel: 0.45,
    biometricStress: 0.2,
    focusVector: { x: 0.5, y: 0.5, depth: 0.35 },
    zones: [],
    annotations: []
});

const DEFAULT_CONTEXT = Object.freeze({
    gazeVelocity: 0.35,
    neuralCoherence: 0.45,
    hapticFeedback: 0.3,
    ambientVariance: 0.25,
    engagementLevel: 0.4,
    gestureIntent: { intensity: 0.3, vector: { x: 0.5, y: 0.5, z: 0.4 } }
});

const RANGE_RULES = Object.freeze({
    blueprint: {
        intensity: [0, 1],
        engagementLevel: [0, 1],
        biometricStress: [0, 1],
        focusVector: {
            x: [0, 1],
            y: [0, 1],
            depth: [0, 1]
        },
        zone: {
            occupancy: [0, 1],
            visibility: [0, 1],
            curvature: [0, 1],
            layeringDepth: [0, 1]
        }
    },
    context: {
        gazeVelocity: [0, 1],
        neuralCoherence: [0, 1],
        hapticFeedback: [0, 1],
        ambientVariance: [0, 1],
        engagementLevel: [0, 1],
        gestureIntent: {
            intensity: [0, 1],
            vector: {
                x: [0, 1],
                y: [0, 1],
                z: [0, 1]
            }
        }
    }
});

function sanitizeRange(range, issues, path) {
    if (!range) {
        return undefined;
    }
    const sanitized = {};
    if ('start' in range) {
        const original = range.start;
        const value = clamp(range.start, 0, 1);
        sanitized.start = value;
        if (value !== original) {
            pushIssue(issues, {
                code: 'clamped-modulation-start',
                path: `${path}.start`,
                message: 'Modulation start was clamped to the 0–1 range.'
            });
        }
    }
    if ('end' in range) {
        const original = range.end;
        const value = clamp(range.end, 0, 1);
        sanitized.end = value;
        if (value !== original) {
            pushIssue(issues, {
                code: 'clamped-modulation-end',
                path: `${path}.end`,
                message: 'Modulation end was clamped to the 0–1 range.'
            });
        }
    }
    if ('easing' in range && typeof range.easing === 'string') {
        sanitized.easing = range.easing;
    }
    return sanitized;
}

export class ProjectionScenarioParameterValidator {
    constructor(options = {}) {
        this.options = options;
    }

    validateScenario(descriptor) {
        const issues = [];
        const normalized = normalizeProjectionScenarioDescriptor(descriptor);
        const scenario = deepClone(normalized);

        scenario.metadata = scenario.metadata && typeof scenario.metadata === 'object'
            ? deepClone(scenario.metadata)
            : {};

        if (!scenario.blueprint) {
            pushIssue(issues, {
                code: 'missing-blueprint',
                path: 'blueprint',
                message: 'Scenario blueprint missing—using default adaptive scaffold.'
            });
            scenario.blueprint = deepClone(DEFAULT_BLUEPRINT);
        } else {
            scenario.blueprint = this.validateBlueprint(scenario.blueprint, issues);
        }

        scenario.context = this.validateContext(scenario.context, issues);
        scenario.modulation = this.validateModulation(scenario.modulation, issues);

        if (!Array.isArray(scenario.anchors)) {
            pushIssue(issues, {
                code: 'invalid-anchors',
                path: 'anchors',
                message: 'Anchors should be an array—reset to empty list.'
            });
            scenario.anchors = [];
        }

        return { scenario, issues };
    }

    validateBlueprint(blueprint, issues, path = 'blueprint') {
        const sanitized = deepClone(DEFAULT_BLUEPRINT);
        const source = blueprint && typeof blueprint === 'object' ? blueprint : {};

        for (const key of ['intensity', 'engagementLevel', 'biometricStress']) {
            const original = source[key];
            const clamped = clamp(original, ...RANGE_RULES.blueprint[key]);
            sanitized[key] = clamped;
            if (!Number.isFinite(Number(original))) {
                pushIssue(issues, {
                    code: 'invalid-blueprint-value',
                    path: `${path}.${key}`,
                    message: 'Blueprint value must be numeric—default applied.'
                });
            } else if (clamped !== original) {
                pushIssue(issues, {
                    code: 'clamped-blueprint-value',
                    path: `${path}.${key}`,
                    message: 'Blueprint value clamped to 0–1 range.'
                });
            }
        }

        const focusVector = source.focusVector && typeof source.focusVector === 'object'
            ? source.focusVector
            : DEFAULT_BLUEPRINT.focusVector;
        sanitized.focusVector = {
            x: clamp(focusVector.x, ...RANGE_RULES.blueprint.focusVector.x),
            y: clamp(focusVector.y, ...RANGE_RULES.blueprint.focusVector.y),
            depth: clamp(focusVector.depth, ...RANGE_RULES.blueprint.focusVector.depth)
        };
        for (const axis of ['x', 'y', 'depth']) {
            const original = focusVector[axis];
            if (!Number.isFinite(Number(original))) {
                pushIssue(issues, {
                    code: 'invalid-focus-vector',
                    path: `${path}.focusVector.${axis}`,
                    message: 'Focus vector value must be numeric—default applied.'
                });
            } else if (sanitized.focusVector[axis] !== original) {
                pushIssue(issues, {
                    code: 'clamped-focus-vector',
                    path: `${path}.focusVector.${axis}`,
                    message: 'Focus vector value clamped to 0–1 range.'
                });
            }
        }

        const zones = Array.isArray(source.zones) ? source.zones : [];
        sanitized.zones = zones.map((zone, index) => {
            const zoneId = zone?.id || `zone-${index + 1}`;
            const sanitizedZone = {
                id: zoneId,
                occupancy: clamp(zone?.occupancy, ...RANGE_RULES.blueprint.zone.occupancy),
                visibility: clamp(zone?.visibility, ...RANGE_RULES.blueprint.zone.visibility),
                curvature: clamp(zone?.curvature, ...RANGE_RULES.blueprint.zone.curvature),
                layeringDepth: clamp(zone?.layeringDepth, ...RANGE_RULES.blueprint.zone.layeringDepth)
            };
            for (const key of ['occupancy', 'visibility', 'curvature', 'layeringDepth']) {
                const original = zone?.[key];
                if (!Number.isFinite(Number(original))) {
                    pushIssue(issues, {
                        code: 'invalid-zone-value',
                        path: `${path}.zones[${zoneId}].${key}`,
                        message: 'Zone value must be numeric—default applied.'
                    });
                } else if (sanitizedZone[key] !== original) {
                    pushIssue(issues, {
                        code: 'clamped-zone-value',
                        path: `${path}.zones[${zoneId}].${key}`,
                        message: 'Zone value clamped to 0–1 range.'
                    });
                }
            }
            return sanitizedZone;
        });

        sanitized.annotations = Array.isArray(source.annotations)
            ? deepClone(source.annotations)
            : [];

        return sanitized;
    }

    validateContext(context, issues, path = 'context') {
        const sanitized = deepClone(DEFAULT_CONTEXT);
        const source = context && typeof context === 'object' ? context : {};

        for (const key of ['gazeVelocity', 'neuralCoherence', 'hapticFeedback', 'ambientVariance', 'engagementLevel']) {
            const original = source[key];
            const clamped = clamp(original, ...RANGE_RULES.context[key]);
            sanitized[key] = clamped;
            if (!Number.isFinite(Number(original))) {
                pushIssue(issues, {
                    code: 'invalid-context-value',
                    path: `${path}.${key}`,
                    message: 'Context value must be numeric—default applied.'
                });
            } else if (clamped !== original) {
                pushIssue(issues, {
                    code: 'clamped-context-value',
                    path: `${path}.${key}`,
                    message: 'Context value clamped to 0–1 range.'
                });
            }
        }

        const intent = source.gestureIntent && typeof source.gestureIntent === 'object'
            ? source.gestureIntent
            : DEFAULT_CONTEXT.gestureIntent;
        sanitized.gestureIntent = {
            intensity: clamp(intent.intensity, ...RANGE_RULES.context.gestureIntent.intensity),
            vector: {
                x: clamp(intent.vector?.x, ...RANGE_RULES.context.gestureIntent.vector.x),
                y: clamp(intent.vector?.y, ...RANGE_RULES.context.gestureIntent.vector.y),
                z: clamp(intent.vector?.z, ...RANGE_RULES.context.gestureIntent.vector.z)
            }
        };

        if (!Number.isFinite(Number(intent.intensity))) {
            pushIssue(issues, {
                code: 'invalid-gesture-intensity',
                path: `${path}.gestureIntent.intensity`,
                message: 'Gesture intensity must be numeric—default applied.'
            });
        } else if (sanitized.gestureIntent.intensity !== intent.intensity) {
            pushIssue(issues, {
                code: 'clamped-gesture-intensity',
                path: `${path}.gestureIntent.intensity`,
                message: 'Gesture intensity clamped to 0–1 range.'
            });
        }

        for (const axis of ['x', 'y', 'z']) {
            const original = intent.vector?.[axis];
            if (!Number.isFinite(Number(original))) {
                pushIssue(issues, {
                    code: 'invalid-gesture-vector',
                    path: `${path}.gestureIntent.vector.${axis}`,
                    message: 'Gesture vector values must be numeric—default applied.'
                });
            } else if (sanitized.gestureIntent.vector[axis] !== original) {
                pushIssue(issues, {
                    code: 'clamped-gesture-vector',
                    path: `${path}.gestureIntent.vector.${axis}`,
                    message: 'Gesture vector value clamped to 0–1 range.'
                });
            }
        }

        return sanitized;
    }

    validateModulation(modulation, issues, path = 'modulation') {
        const sanitized = {};
        const source = modulation && typeof modulation === 'object' ? modulation : {};

        if (source.blueprint && typeof source.blueprint === 'object') {
            sanitized.blueprint = {};
            for (const key of ['intensity', 'engagementLevel', 'biometricStress', 'focusX', 'focusY', 'focusDepth']) {
                if (key in source.blueprint) {
                    sanitized.blueprint[key] = sanitizeRange(source.blueprint[key], issues, `${path}.blueprint.${key}`);
                }
            }
            if (Array.isArray(source.blueprint.zoneOccupancy)) {
                sanitized.blueprint.zoneOccupancy = source.blueprint.zoneOccupancy.map((entry, index) => {
                    const id = entry?.id || `zone-${index + 1}`;
                    const sanitizedEntry = { id };
                    const range = sanitizeRange(entry, issues, `${path}.blueprint.zoneOccupancy[${id}]`);
                    if (range) {
                        Object.assign(sanitizedEntry, range);
                    }
                    return sanitizedEntry;
                });
            }
        }

        if (source.context && typeof source.context === 'object') {
            sanitized.context = {};
            for (const key of ['gazeVelocity', 'neuralCoherence', 'hapticFeedback', 'engagementLevel', 'gestureIntensity', 'gestureX', 'gestureY', 'gestureZ']) {
                if (key in source.context) {
                    sanitized.context[key] = sanitizeRange(source.context[key], issues, `${path}.context.${key}`);
                }
            }
        }

        if (source.composerOptions && typeof source.composerOptions === 'object') {
            sanitized.composerOptions = deepClone(source.composerOptions);
        }

        return sanitized;
    }
}

export function createProjectionScenarioParameterValidator(options = {}) {
    return new ProjectionScenarioParameterValidator(options);
}
