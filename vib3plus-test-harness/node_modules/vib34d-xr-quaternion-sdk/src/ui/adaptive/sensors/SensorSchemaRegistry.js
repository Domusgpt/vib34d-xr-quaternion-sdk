import { normalizeXRPosePayload } from './xr/XRPoseNormalizer.js';

/**
 * SensorSchemaRegistry
 * ------------------------------------------------------------
 * Normalizes heterogeneous sensor payloads before they are applied to
 * higher-level adaptive behaviours. The registry ships with baseline schemas
 * for the core focus/intent/biometric channels and can be extended at runtime
 * with wearables-specific composite payloads.
 */

/**
 * @typedef {Object} SensorSchemaIssue
 * @property {string} field
 * @property {string} code
 * @property {string} [message]
 */

/**
 * @typedef {Object} SensorSchemaResult
 * @property {Record<string, any>} payload
 * @property {SensorSchemaIssue[]} issues
 */

/**
 * @typedef {{ normalize(payload: Record<string, any>, registry: SensorSchemaRegistry): SensorSchemaResult | Record<string, any>; fallback?: Record<string, any>; }} SensorSchemaDefinition
 */

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getPath = (source, path) => {
    if (!path) return undefined;
    const parts = Array.isArray(path) ? path : String(path).split('.');
    let current = source;
    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return undefined;
        }
        current = current[part];
    }
    return current;
};

const firstPresent = values => {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
};

const compactObject = value => {
    if (!isPlainObject(value)) return undefined;
    const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined && entry !== null);
    if (entries.length === 0) {
        return undefined;
    }
    return Object.fromEntries(entries);
};

const SPATIAL_SPACE_TYPES = [
    'viewer',
    'local',
    'local-floor',
    'bounded-floor',
    'unbounded',
    'stage',
    'device',
    'custom'
];

const PLANE_ALIGNMENTS = ['horizontal', 'vertical', 'slanted', 'unknown'];
const PLANE_CLASSIFICATIONS = ['floor', 'ceiling', 'wall', 'table', 'seat', 'screen', 'platform', 'unknown'];
const TRACKING_STATES = ['tracked', 'emulated', 'paused', 'unknown'];
const HIT_TEST_ENTITY_TYPES = ['plane', 'mesh', 'point', 'feature-point', 'unknown'];
const HIT_TEST_RESULT_TYPES = ['plane', 'mesh', 'point', 'feature-point', 'unknown'];
const HANDEDNESS_VALUES = ['none', 'left', 'right'];

const DEFAULT_MATRIX4 = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
];

const sanitizeNumberArray = (registry, source, field, options = {}) => {
    if (!Array.isArray(source) || source.length === 0) {
        return undefined;
    }
    const sanitized = source.map((entry, index) => registry.ensureNumber(entry, {
        ...options,
        field: `${field}.${index}`
    }));
    return sanitized.length ? sanitized : undefined;
};

const createWearableCompositeSchema = config => ({
    normalize(payload = {}, registry) {
        const issues = [];
        const safe = isPlainObject(payload) ? payload : {};

        const deviceId = registry.ensureString(
            firstPresent([
                safe.deviceId,
                config.defaultDeviceId
            ]),
            {
                field: 'deviceId',
                allowEmpty: false,
                defaultValue: config.defaultDeviceId || 'wearable-device',
                issues
            }
        );

        const firmwareVersion = registry.ensureOptionalString(
            firstPresent([
                safe.firmwareVersion,
                getPath(safe, 'metadata.firmwareVersion')
            ]),
            {
                field: 'firmwareVersion',
                defaultValue: null,
                issues
            }
        );

        const channels = {};
        for (const channelConfig of config.channels || []) {
            const rawSource = channelConfig.fromRaw
                ? channelConfig.fromRaw(safe)
                : firstPresent((channelConfig.sources || []).map(source => getPath(safe, source)));

            if (!rawSource) {
                if (channelConfig.required) {
                    issues.push({
                        field: `channels.${channelConfig.channel}`,
                        code: 'missing',
                        message: `${channelConfig.channel} channel is required.`
                    });
                }
                continue;
            }

            const sourcePayload = isPlainObject(rawSource.payload)
                ? rawSource.payload
                : (isPlainObject(rawSource) ? rawSource : {});

            const { payload: channelPayload, issues: channelIssues } = registry.validate(
                channelConfig.schema,
                sourcePayload
            );

            if (Array.isArray(channelIssues) && channelIssues.length) {
                for (const issue of channelIssues) {
                    issues.push({
                        field: issue.field && issue.field !== '*'
                            ? `channels.${channelConfig.channel}.${issue.field}`
                            : `channels.${channelConfig.channel}`,
                        code: issue.code,
                        message: issue.message
                    });
                }
            }

            if (typeof channelConfig.extend === 'function') {
                channelConfig.extend(channelPayload, rawSource, { registry, issues });
            }

            const confidenceCandidates = [];
            if (Array.isArray(channelConfig.confidencePaths)) {
                for (const path of channelConfig.confidencePaths) {
                    confidenceCandidates.push(getPath({ source: rawSource, root: safe }, path));
                }
            } else if (typeof channelConfig.confidence === 'function') {
                confidenceCandidates.push(channelConfig.confidence(rawSource, safe));
            } else if (channelConfig.confidence !== undefined) {
                confidenceCandidates.push(channelConfig.confidence);
            } else {
                confidenceCandidates.push(rawSource.confidence);
            }

            const confidence = registry.ensureNumber(
                firstPresent(confidenceCandidates),
                {
                    field: `channels.${channelConfig.channel}.confidence`,
                    min: 0,
                    max: 1,
                    defaultValue: channelConfig.defaultConfidence ?? 1,
                    issues
                }
            );

            channels[channelConfig.channel] = {
                payload: channelPayload,
                confidence
            };
        }

        let metadata;
        if (typeof config.metadata === 'function') {
            metadata = compactObject(config.metadata(safe, { registry, issues }, config));
        }

        const normalized = {
            deviceId,
            firmwareVersion,
            channels
        };

        if (metadata && Object.keys(metadata).length) {
            normalized.metadata = metadata;
        }

        return { payload: normalized, issues };
    }
});

export class SensorSchemaRegistry {
    constructor(options = {}) {
        const { registerDefaults = true, schemas } = options;
        this.schemas = new Map();

        if (registerDefaults) {
            this.registerDefaultSchemas();
        }

        if (schemas) {
            this.loadCustomSchemas(schemas);
        }
    }

    /**
     * @param {string} type
     * @param {SensorSchemaDefinition | ((payload: Record<string, any>) => SensorSchemaResult | Record<string, any>)} schema
     */
    register(type, schema) {
        if (!type || typeof type !== 'string') {
            throw new Error('SensorSchemaRegistry.register requires a sensor type string');
        }

        const normalizedSchema = typeof schema === 'function' ? { normalize: schema } : schema;
        if (!normalizedSchema || typeof normalizedSchema.normalize !== 'function') {
            throw new Error(`Sensor schema for ${type} must provide a normalize(payload) function`);
        }

        this.schemas.set(type, normalizedSchema);
    }

    loadCustomSchemas(schemas) {
        if (Array.isArray(schemas)) {
            for (const entry of schemas) {
                if (!entry) continue;
                if (Array.isArray(entry) && entry.length === 2) {
                    this.register(entry[0], entry[1]);
                } else if (typeof entry === 'object' && entry.type && entry.schema) {
                    this.register(entry.type, entry.schema);
                }
            }
            return;
        }

        if (isPlainObject(schemas)) {
            for (const [type, schema] of Object.entries(schemas)) {
                this.register(type, schema);
            }
        }
    }

    /**
     * @param {string} type
     * @param {Record<string, any>} payload
     * @returns {SensorSchemaResult}
     */
    validate(type, payload) {
        const schema = this.schemas.get(type);
        if (!schema) {
            return { payload: payload ?? {}, issues: [] };
        }

        try {
            const result = schema.normalize(payload ?? {}, this);
            if (!result || typeof result !== 'object') {
                return {
                    payload: {},
                    issues: [{ field: '*', code: 'schema-invalid-return', message: 'Schema normalize must return an object.' }]
                };
            }

            if ('payload' in result) {
                return {
                    payload: result.payload ?? {},
                    issues: Array.isArray(result.issues) ? result.issues : []
                };
            }

            return { payload: result, issues: [] };
        } catch (error) {
            return {
                payload: schema.fallback ?? {},
                issues: [{ field: '*', code: 'schema-error', message: error?.message || 'Schema normalization failed.' }]
            };
        }
    }

    registerDefaultSchemas() {
        this.register('eye-tracking', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const normalized = {
                    x: this.ensureNumber(safe.x, { field: 'x', min: 0, max: 1, defaultValue: 0.5, precision: 3, issues }),
                    y: this.ensureNumber(safe.y, { field: 'y', min: 0, max: 1, defaultValue: 0.5, precision: 3, issues }),
                    depth: this.ensureNumber(safe.depth, { field: 'depth', min: 0, max: 1, defaultValue: 0.3, precision: 3, issues })
                };

                if (safe.vergence !== undefined) {
                    normalized.vergence = this.ensureNumber(safe.vergence, { field: 'vergence', min: 0, max: 5, defaultValue: 0, precision: 2, issues });
                }
                if (safe.stability !== undefined) {
                    normalized.stability = this.ensureNumber(safe.stability, { field: 'stability', min: 0, max: 1, defaultValue: 0.5, precision: 2, issues });
                }
                if (safe.blinkRate !== undefined) {
                    normalized.blinkRate = this.ensureNumber(safe.blinkRate, { field: 'blinkRate', min: 0, max: 2.5, defaultValue: 0.2, precision: 2, issues });
                }
                if (safe.fixation !== undefined) {
                    normalized.fixation = this.ensureNumber(safe.fixation, { field: 'fixation', min: 0, max: 1, defaultValue: 0, precision: 3, issues });
                }

                return { payload: normalized, issues };
            },
            fallback: { x: 0.5, y: 0.5, depth: 0.3 }
        });

        this.register('neural-intent', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const normalized = {
                    x: this.ensureNumber(safe.x, { field: 'x', min: -1, max: 1, defaultValue: 0, precision: 3, issues }),
                    y: this.ensureNumber(safe.y, { field: 'y', min: -1, max: 1, defaultValue: 0, precision: 3, issues }),
                    z: this.ensureNumber(safe.z, { field: 'z', min: -1, max: 1, defaultValue: 0, precision: 3, issues }),
                    w: this.ensureNumber(safe.w, { field: 'w', min: -1, max: 1, defaultValue: 0, precision: 3, issues }),
                    engagement: this.ensureNumber(safe.engagement, { field: 'engagement', min: 0, max: 1, defaultValue: 0.4, precision: 3, issues })
                };

                if (safe.signalToNoise !== undefined) {
                    normalized.signalToNoise = this.ensureNumber(safe.signalToNoise, { field: 'signalToNoise', min: 0, max: 60, defaultValue: 0, precision: 2, issues });
                }
                if (safe.bandwidth !== undefined) {
                    normalized.bandwidth = this.ensureNumber(safe.bandwidth, { field: 'bandwidth', min: 0, max: 200, defaultValue: 0, precision: 2, issues });
                }

                return { payload: normalized, issues };
            },
            fallback: { x: 0, y: 0, z: 0, w: 0, engagement: 0.4 }
        });

        this.register('biometric', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const normalized = {
                    stress: this.ensureNumber(safe.stress, { field: 'stress', min: 0, max: 1, defaultValue: 0.2, precision: 3, issues }),
                    heartRate: this.ensureInteger(safe.heartRate, { field: 'heartRate', min: 30, max: 220, defaultValue: 68, issues }),
                    temperature: this.ensureNumber(safe.temperature, { field: 'temperature', min: 32, max: 40, defaultValue: 36.4, precision: 1, issues })
                };

                if (safe.oxygen !== undefined) {
                    normalized.oxygen = this.ensureNumber(safe.oxygen, { field: 'oxygen', min: 0, max: 1, defaultValue: 0.95, precision: 3, issues });
                }
                if (safe.hrv !== undefined) {
                    normalized.hrv = this.ensureInteger(safe.hrv, { field: 'hrv', min: 10, max: 200, defaultValue: 52, issues });
                }

                return { payload: normalized, issues };
            },
            fallback: { stress: 0.2, heartRate: 68, temperature: 36.4 }
        });

        this.register('ambient', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const normalized = {
                    luminance: this.ensureNumber(safe.luminance, { field: 'luminance', min: 0, max: 1, defaultValue: 0.5, precision: 3, issues }),
                    noiseLevel: this.ensureNumber(safe.noiseLevel, { field: 'noiseLevel', min: 0, max: 1, defaultValue: 0.2, precision: 3, issues }),
                    motion: this.ensureNumber(safe.motion, { field: 'motion', min: 0, max: 1, defaultValue: 0.1, precision: 3, issues })
                };

                if (safe.temperature !== undefined) {
                    normalized.temperature = this.ensureNumber(safe.temperature, { field: 'temperature', min: -20, max: 60, defaultValue: 22, precision: 1, issues });
                }
                if (safe.humidity !== undefined) {
                    normalized.humidity = this.ensureNumber(safe.humidity, { field: 'humidity', min: 0, max: 1, defaultValue: 0.5, precision: 3, issues });
                }

                return { payload: normalized, issues };
            },
            fallback: { luminance: 0.5, noiseLevel: 0.2, motion: 0.1 }
        });

        this.register('gesture', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const normalized = {
                    intent: this.ensureString(safe.intent, { field: 'intent', allowEmpty: true, defaultValue: null, issues }),
                    vector: this.ensureVector(safe.vector, { field: 'vector', min: -1, max: 1, defaultValue: 0, issues })
                };

                if (safe.intentStrength !== undefined) {
                    normalized.intentStrength = this.ensureNumber(safe.intentStrength, { field: 'intentStrength', min: 0, max: 1, defaultValue: 0, precision: 2, issues });
                }

                return { payload: normalized, issues };
            },
            fallback: { intent: null, vector: { x: 0, y: 0, z: 0 } }
        });

        this.registerWearableSchemas();
    }

    registerWearableSchemas() {
        this.register('wearable.ar-visor', createWearableCompositeSchema({
            defaultDeviceId: 'wearable.ar-visor',
            fieldOfViewDefaults: { horizontal: 110, vertical: 90, diagonal: 120 },
            channels: [
                {
                    channel: 'eye-tracking',
                    schema: 'eye-tracking',
                    sources: ['channels.eye-tracking', 'gaze', 'focus'],
                    required: true,
                    defaultConfidence: 0.82,
                    confidencePaths: ['source.confidence', 'root.focusConfidence', 'root.quality.focus'],
                    extend: (payload, source, { registry, issues }) => {
                        if (source && source.vergence !== undefined) {
                            payload.vergence = registry.ensureNumber(source.vergence, { field: 'channels.eye-tracking.vergence', min: 0, max: 5, defaultValue: 0, precision: 2, issues });
                        }
                        if (source && source.stability !== undefined) {
                            payload.stability = registry.ensureNumber(source.stability, { field: 'channels.eye-tracking.stability', min: 0, max: 1, defaultValue: 0.5, precision: 2, issues });
                        }
                        if (source && source.blinkRate !== undefined) {
                            payload.blinkRate = registry.ensureNumber(source.blinkRate, { field: 'channels.eye-tracking.blinkRate', min: 0, max: 2.5, defaultValue: 0.2, precision: 2, issues });
                        }
                    }
                },
                {
                    channel: 'ambient',
                    schema: 'ambient',
                    sources: ['channels.ambient', 'environment'],
                    defaultConfidence: 0.65,
                    confidencePaths: ['source.confidence', 'root.quality.environment'],
                    extend: (payload, source, { registry, issues }) => {
                        if (source && source.temperature !== undefined) {
                            payload.temperature = registry.ensureNumber(source.temperature, { field: 'channels.ambient.temperature', min: -20, max: 60, defaultValue: 22, precision: 1, issues });
                        }
                    }
                },
                {
                    channel: 'gesture',
                    schema: 'gesture',
                    sources: ['channels.gesture', 'gesture'],
                    defaultConfidence: 0.6,
                    confidencePaths: ['source.confidence', 'root.quality.gesture', 'root.quality.focus']
                },
                {
                    channel: 'spatial.planes',
                    schema: 'spatial.scene-planes',
                    sources: ['channels.spatial.planes', 'spatial.planes', 'scene.planes'],
                    defaultConfidence: 0.78,
                    confidencePaths: ['source.confidence', 'root.quality.scene', 'root.sceneConfidence']
                },
                {
                    channel: 'spatial.depth',
                    schema: 'spatial.depth-buffer',
                    sources: ['channels.spatial.depth', 'spatial.depth', 'scene.depth'],
                    defaultConfidence: 0.72,
                    confidencePaths: ['source.confidence', 'root.quality.scene', 'root.depthConfidence']
                },
                {
                    channel: 'spatial.hit-tests',
                    schema: 'spatial.hit-test-results',
                    sources: ['channels.spatial.hitTests', 'spatial.hitTests', 'scene.hitTests'],
                    defaultConfidence: 0.8,
                    confidencePaths: ['source.confidence', 'root.quality.scene', 'root.hitTestConfidence']
                },
                {
                    channel: 'spatial.anchors',
                    schema: 'spatial.anchors',
                    sources: ['channels.spatial.anchors', 'spatial.anchors', 'scene.anchors'],
                    defaultConfidence: 0.76,
                    confidencePaths: ['source.confidence', 'root.quality.scene', 'root.anchorConfidence']
                }
            ],
            metadata: (root, { registry, issues }, schemaConfig) => {
                const metadata = {};
                const fieldOfViewSource = firstPresent([
                    getPath(root, 'metadata.fieldOfView'),
                    root.fieldOfView
                ]);
                if (isPlainObject(fieldOfViewSource) || schemaConfig.fieldOfViewDefaults) {
                    const defaults = schemaConfig.fieldOfViewDefaults || {};
                    const fieldOfView = {
                        horizontal: registry.ensureNumber(fieldOfViewSource?.horizontal ?? defaults.horizontal ?? 110, { field: 'metadata.fieldOfView.horizontal', min: 40, max: 160, defaultValue: 110, issues }),
                        vertical: registry.ensureNumber(fieldOfViewSource?.vertical ?? defaults.vertical ?? 90, { field: 'metadata.fieldOfView.vertical', min: 30, max: 140, defaultValue: 90, issues })
                    };
                    if (fieldOfViewSource?.diagonal !== undefined || defaults.diagonal !== undefined) {
                        fieldOfView.diagonal = registry.ensureNumber(fieldOfViewSource?.diagonal ?? defaults.diagonal ?? 120, { field: 'metadata.fieldOfView.diagonal', min: 40, max: 180, defaultValue: 120, issues });
                    }
                    metadata.fieldOfView = fieldOfView;
                }

                const poseSource = firstPresent([
                    getPath(root, 'metadata.pose'),
                    root.pose
                ]);
                if (isPlainObject(poseSource)) {
                    const pose = {};
                    if (poseSource.orientation) {
                        pose.orientation = registry.ensureQuaternion(poseSource.orientation, { field: 'metadata.pose.orientation' });
                    }
                    if (poseSource.position) {
                        pose.position = registry.ensureVector(poseSource.position, { field: 'metadata.pose.position', defaultValue: 0 });
                    }
                    if (Object.keys(pose).length) {
                        metadata.pose = pose;
                    }
                }

                const batteryLevel = firstPresent([root.batteryLevel, getPath(root, 'metadata.batteryLevel')]);
                if (batteryLevel !== undefined) {
                    metadata.batteryLevel = registry.ensureNumber(batteryLevel, { field: 'metadata.batteryLevel', min: 0, max: 1, defaultValue: 1, issues });
                }

                const deviceTemperature = firstPresent([
                    root.deviceTemperature,
                    getPath(root, 'metadata.deviceTemperature'),
                    getPath(root, 'environment.temperature')
                ]);
                if (deviceTemperature !== undefined) {
                    metadata.deviceTemperature = registry.ensureNumber(deviceTemperature, { field: 'metadata.deviceTemperature', min: -20, max: 90, defaultValue: 35, precision: 1, issues });
                }

                const uptimeSeconds = firstPresent([root.uptimeSeconds, getPath(root, 'metadata.uptimeSeconds')]);
                if (uptimeSeconds !== undefined) {
                    metadata.uptimeSeconds = registry.ensureNumber(uptimeSeconds, { field: 'metadata.uptimeSeconds', min: 0, max: 604800, defaultValue: 0, issues });
                }

                const optics = firstPresent([getPath(root, 'metadata.optics'), root.optics]);
                if (isPlainObject(optics)) {
                    metadata.optics = { ...optics };
                }

                return metadata;
            }
        }));

        this.register('wearable.neural-band', createWearableCompositeSchema({
            defaultDeviceId: 'wearable.neural-band',
            channels: [
                {
                    channel: 'neural-intent',
                    schema: 'neural-intent',
                    sources: ['channels.neural-intent', 'intent', 'signal'],
                    required: true,
                    defaultConfidence: 0.7,
                    confidencePaths: ['source.confidence', 'root.signalQuality.overall', 'root.quality.intent']
                },
                {
                    channel: 'gesture',
                    schema: 'gesture',
                    sources: ['channels.gesture', 'gesture'],
                    defaultConfidence: 0.6,
                    confidencePaths: ['source.confidence', 'root.quality.gesture']
                }
            ],
            metadata: (root, { registry, issues }) => {
                const metadata = {};

                const signalQualitySource = firstPresent([
                    getPath(root, 'metadata.signalQuality'),
                    root.signalQuality
                ]);
                if (isPlainObject(signalQualitySource)) {
                    const quality = {};
                    if (signalQualitySource.overall !== undefined) {
                        quality.overall = registry.ensureNumber(signalQualitySource.overall, { field: 'metadata.signalQuality.overall', min: 0, max: 1, defaultValue: 0.5 });
                    }
                    if (signalQualitySource.contacts) {
                        quality.contacts = sanitizeNumberArray(registry, signalQualitySource.contacts, 'metadata.signalQuality.contacts', { min: 0, max: 1, defaultValue: 0.5, issues });
                    }
                    if (Object.keys(quality).length) {
                        metadata.signalQuality = quality;
                    }
                }

                const impedanceSource = firstPresent([
                    getPath(root, 'metadata.impedance'),
                    root.impedance
                ]);
                if (isPlainObject(impedanceSource)) {
                    metadata.impedance = {
                        average: registry.ensureNumber(impedanceSource.average, { field: 'metadata.impedance.average', min: 0, max: 500, defaultValue: 0 }),
                        variance: registry.ensureNumber(impedanceSource.variance, { field: 'metadata.impedance.variance', min: 0, max: 500, defaultValue: 0 })
                    };
                }

                const contactState = firstPresent([
                    getPath(root, 'metadata.contact.state'),
                    root.contactState
                ]);
                const electrodes = firstPresent([
                    getPath(root, 'metadata.contact.electrodes'),
                    root.electrodes
                ]);
                if (contactState !== undefined || electrodes !== undefined) {
                    const contact = {};
                    if (contactState !== undefined) {
                        contact.state = registry.ensureString(contactState, { field: 'metadata.contact.state', allowEmpty: true, defaultValue: null, issues });
                    }
                    const sanitizedElectrodes = sanitizeNumberArray(registry, electrodes, 'metadata.contact.electrodes', { min: 0, max: 1, defaultValue: 0.5, issues });
                    if (sanitizedElectrodes) {
                        contact.electrodes = sanitizedElectrodes;
                    }
                    if (Object.keys(contact).length) {
                        metadata.contact = contact;
                    }
                }

                const bandSource = firstPresent([
                    getPath(root, 'metadata.band'),
                    root.band
                ]);
                if (isPlainObject(bandSource)) {
                    const band = {};
                    if (bandSource.firmware !== undefined) {
                        band.firmware = registry.ensureOptionalString(bandSource.firmware, { field: 'metadata.band.firmware', defaultValue: null });
                    }
                    if (bandSource.hardwareRevision !== undefined) {
                        band.hardwareRevision = registry.ensureOptionalString(bandSource.hardwareRevision, { field: 'metadata.band.hardwareRevision', defaultValue: null });
                    }
                    if (Object.keys(band).length) {
                        metadata.band = band;
                    }
                }

                const deviceTemperature = firstPresent([root.temperature, getPath(root, 'metadata.deviceTemperature')]);
                if (deviceTemperature !== undefined) {
                    metadata.deviceTemperature = registry.ensureNumber(deviceTemperature, { field: 'metadata.deviceTemperature', min: 0, max: 60, defaultValue: 33, precision: 1 });
                }

                return metadata;
            }
        }));

        this.register('wearable.biometric-wrist', createWearableCompositeSchema({
            defaultDeviceId: 'wearable.biometric-wrist',
            channels: [
                {
                    channel: 'biometric',
                    schema: 'biometric',
                    sources: ['channels.biometric', 'vitals', 'biometric'],
                    required: true,
                    defaultConfidence: 0.75,
                    confidencePaths: ['source.confidence', 'root.quality.vitals', 'root.quality.overall']
                },
                {
                    channel: 'ambient',
                    schema: 'ambient',
                    sources: ['channels.ambient', 'environment'],
                    defaultConfidence: 0.6,
                    confidencePaths: ['source.confidence', 'root.quality.environment', 'root.quality.motion']
                }
            ],
            metadata: (root, { registry, issues }) => {
                const metadata = {};

                const batteryLevel = firstPresent([root.batteryLevel, getPath(root, 'metadata.batteryLevel')]);
                if (batteryLevel !== undefined) {
                    metadata.batteryLevel = registry.ensureNumber(batteryLevel, { field: 'metadata.batteryLevel', min: 0, max: 1, defaultValue: 1 });
                }

                const skinContact = firstPresent([root.skinContact, getPath(root, 'metadata.skinContact')]);
                if (skinContact !== undefined) {
                    metadata.skinContact = registry.ensureBoolean(skinContact, { field: 'metadata.skinContact', defaultValue: false, issues });
                }

                const lastSync = firstPresent([root.lastSync, getPath(root, 'metadata.lastSync')]);
                if (lastSync !== undefined) {
                    metadata.lastSync = registry.ensureOptionalString(lastSync, { field: 'metadata.lastSync', defaultValue: null });
                }

                const motionSource = firstPresent([
                    getPath(root, 'metadata.motion'),
                    root.motion
                ]);
                if (isPlainObject(motionSource)) {
                    const motion = {};
                    if (motionSource.acceleration) {
                        motion.acceleration = registry.ensureVector(motionSource.acceleration, { field: 'metadata.motion.acceleration', defaultValue: 0 });
                    }
                    if (Object.keys(motion).length) {
                        metadata.motion = motion;
                    }
                }

                const deviceTemperature = firstPresent([root.deviceTemperature, getPath(root, 'metadata.deviceTemperature')]);
                if (deviceTemperature !== undefined) {
                    metadata.deviceTemperature = registry.ensureNumber(deviceTemperature, { field: 'metadata.deviceTemperature', min: 0, max: 60, defaultValue: 33, precision: 1 });
                }

                const alerts = firstPresent([root.alerts, getPath(root, 'metadata.alerts')]);
                if (Array.isArray(alerts)) {
                    const sanitizedAlerts = alerts
                        .map((entry, index) => {
                            if (typeof entry === 'string') {
                                const trimmed = entry.trim();
                                if (trimmed) return trimmed;
                            }
                            issues.push({ field: `metadata.alerts.${index}`, code: 'type', message: 'Alert entries must be non-empty strings.' });
                            return null;
                        })
                        .filter(Boolean);
                    if (sanitizedAlerts.length) {
                        metadata.alerts = sanitizedAlerts;
                    }
                }

                return metadata;
            }
        }));

        this.registerSpatialSchemas();
    }

    registerSpatialSchemas() {
        this.register('spatial.pose', {
            normalize: payload => {
                const { pose, issues } = normalizeXRPosePayload(payload, { registry: this });
                const normalized = {
                    position: pose.position,
                    orientation: pose.orientation,
                    linearVelocity: pose.linearVelocity ?? null,
                    angularVelocity: pose.angularVelocity ?? null,
                    referenceSpaceType: pose.referenceSpaceType ?? 'local',
                    referenceSpaceId: pose.referenceSpaceId ?? null,
                    emulatedPosition: typeof pose.emulatedPosition === 'boolean' ? pose.emulatedPosition : null,
                    trackingState: pose.trackingState ?? 'unknown',
                    radius: pose.radius ?? null,
                    confidence: Number.isFinite(pose.confidence) ? Math.max(0, Math.min(1, pose.confidence)) : undefined
                };

                return { payload: normalized, issues };
            },
            fallback: {
                position: { x: 0, y: 0, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
                linearVelocity: null,
                angularVelocity: null,
                referenceSpaceType: 'local',
                referenceSpaceId: null,
                emulatedPosition: null,
                trackingState: 'unknown',
                radius: null,
                confidence: 1
            }
        });

        this.register('spatial.space-reference', {
            normalize: payload => ({
                payload: this.ensureSpaceReference(payload, { field: 'space' }),
                issues: []
            }),
            fallback: { type: 'local', id: null }
        });

        this.register('spatial.scene-plane', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const id = this.ensureString(firstPresent([safe.id, safe.planeId]), { field: 'id', allowEmpty: false, defaultValue: 'plane', issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'local', issues });
                const pose = this.ensurePose(firstPresent([safe.pose, safe.transform, safe]), { field: 'pose', issues });
                const alignment = this.ensureEnum(firstPresent([safe.alignment, safe.orientation, safe.alignmentHint]), { field: 'alignment', allowed: PLANE_ALIGNMENTS, defaultValue: 'unknown', issues, allowUndefined: true });
                const extentSource = isPlainObject(safe.extent) ? safe.extent : safe.size;
                const extent = extentSource
                    ? {
                        width: this.ensureNumber(firstPresent([extentSource.width, extentSource.x, extentSource[0]]), { field: 'extent.width', min: 0, max: 200, defaultValue: 0, precision: 4, issues }),
                        height: this.ensureNumber(firstPresent([extentSource.height, extentSource.y, extentSource[1]]), { field: 'extent.height', min: 0, max: 200, defaultValue: 0, precision: 4, issues })
                    }
                    : { width: 0, height: 0 };
                const polygon = this.ensureVectorArray(firstPresent([safe.polygon, safe.polygonPoints, safe.points]), { field: 'polygon', minLength: 3, issues });
                const lastChangedTime = this.ensureNumber(firstPresent([safe.lastChangedTime, safe.timestamp, safe.time]), { field: 'lastChangedTime', min: 0, defaultValue: 0, issues });
                const trackingState = this.ensureOptionalEnum(firstPresent([safe.trackingState, safe.state]), { field: 'trackingState', allowed: TRACKING_STATES, defaultValue: 'tracked', issues });
                const classification = this.ensureOptionalEnum(firstPresent([safe.classification, safe.semanticLabel]), { field: 'classification', allowed: PLANE_CLASSIFICATIONS, defaultValue: 'unknown', issues });

                const normalized = compactObject({
                    id,
                    space,
                    pose,
                    alignment,
                    extent,
                    polygon: polygon?.length ? polygon : undefined,
                    lastChangedTime,
                    trackingState,
                    classification
                });

                return { payload: normalized, issues };
            },
            fallback: {
                id: 'plane',
                space: { type: 'local', id: null },
                pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
                alignment: 'unknown',
                extent: { width: 0, height: 0 },
                polygon: [],
                lastChangedTime: 0
            }
        });

        this.register('spatial.scene-planes', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const timestamp = this.ensureNumber(firstPresent([safe.timestamp, safe.time, safe.lastChangedTime]), { field: 'timestamp', min: 0, defaultValue: 0, issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'local', issues });
                const planesSource = Array.isArray(safe.planes) ? safe.planes : (Array.isArray(safe.added) ? safe.added : []);
                const planes = [];

                planesSource.forEach((entry, index) => {
                    const result = this.validate('spatial.scene-plane', entry);
                    planes.push(result.payload);
                    if (result.issues?.length) {
                        for (const issue of result.issues) {
                            issues.push({
                                field: `planes.${index}${issue.field && issue.field !== '*' ? `.${issue.field}` : ''}`,
                                code: issue.code,
                                message: issue.message
                            });
                        }
                    }
                });

                const removedIds = this.ensureStringArray(firstPresent([safe.removedIds, safe.removed, safe.deletedIds]), { field: 'removedIds', allowEmpty: true, issues });

                const normalized = compactObject({
                    timestamp,
                    space,
                    planes,
                    removedIds: removedIds.length ? removedIds : undefined
                });

                return { payload: normalized, issues };
            },
            fallback: { timestamp: 0, space: { type: 'local', id: null }, planes: [] }
        });

        this.register('spatial.depth-buffer', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const timestamp = this.ensureNumber(firstPresent([safe.timestamp, safe.time]), { field: 'timestamp', min: 0, defaultValue: 0, issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'viewer', issues });
                const viewId = this.ensureOptionalString(firstPresent([safe.viewId, safe.view, safe.cameraId]), { field: 'viewId', issues });
                const format = this.ensureString(firstPresent([safe.format, safe.pixelFormat]), { field: 'format', allowEmpty: false, defaultValue: 'unknown', issues });
                const width = this.ensureInteger(safe.width, { field: 'width', min: 1, max: 8192, defaultValue: 1, issues });
                const height = this.ensureInteger(safe.height, { field: 'height', min: 1, max: 8192, defaultValue: 1, issues });
                const rawValueToMeters = this.ensureNumber(firstPresent([safe.rawValueToMeters, safe.metersPerUnit]), { field: 'rawValueToMeters', min: 1e-6, max: 100, defaultValue: 0.001, precision: 6, issues });
                const near = this.ensureOptionalNumber(firstPresent([safe.near, safe.nearDepth]), { field: 'near', min: 0, max: 1000, defaultValue: null, issues });
                const far = this.ensureOptionalNumber(firstPresent([safe.far, safe.farDepth]), { field: 'far', min: 0, max: 1000, defaultValue: null, issues });
                const intrinsics = this.ensureCameraIntrinsics(firstPresent([safe.intrinsics, safe.cameraIntrinsics]), { field: 'intrinsics', issues });
                const buffer = this.ensureDepthBufferDescriptor(firstPresent([safe.buffer, safe.resource, safe.data]), { field: 'buffer', issues });
                const confidence = this.ensureOptionalNumber(safe.confidence, { field: 'confidence', min: 0, max: 1, defaultValue: null, issues });

                const normalized = compactObject({
                    timestamp,
                    space,
                    viewId,
                    format,
                    width,
                    height,
                    rawValueToMeters,
                    near,
                    far,
                    intrinsics,
                    buffer,
                    confidence
                });

                return { payload: normalized, issues };
            },
            fallback: {
                timestamp: 0,
                space: { type: 'viewer', id: null },
                format: 'unknown',
                width: 1,
                height: 1,
                rawValueToMeters: 0.001,
                buffer: { type: 'cpu', handle: null }
            }
        });

        this.register('spatial.hit-test-ray', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const id = this.ensureString(firstPresent([safe.id, safe.rayId, safe.sourceId]), { field: 'id', allowEmpty: false, defaultValue: 'hit-test-ray', issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'viewer', issues });
                const offsetRay = this.ensureRay(firstPresent([safe.offsetRay, safe.ray, safe.spaceRay]), { field: 'offsetRay', issues });
                const entityTypes = this.ensureEnumArray(firstPresent([safe.entityTypes, safe.entities, safe.filters]), { field: 'entityTypes', allowed: HIT_TEST_ENTITY_TYPES, defaultValue: 'plane', issues, allowEmpty: false });
                const targetRaySpace = this.ensureOptionalString(firstPresent([safe.targetRaySpace, safe.targetSpace]), { field: 'targetRaySpace', issues });
                const handedness = this.ensureOptionalEnum(firstPresent([safe.handedness, safe.inputHandedness]), { field: 'handedness', allowed: HANDEDNESS_VALUES, defaultValue: 'none', issues });
                const transient = this.ensureBoolean(safe.transient ?? safe.transientInput, { field: 'transient', defaultValue: false, issues });
                const profile = this.ensureOptionalString(firstPresent([safe.profile, safe.referenceSpaceType]), { field: 'profile', issues });

                const initialResultsSource = Array.isArray(safe.initialResults) ? safe.initialResults : [];
                const initialResults = [];
                initialResultsSource.forEach((entry, index) => {
                    const result = this.validate('spatial.hit-test-result', entry);
                    initialResults.push(result.payload);
                    if (result.issues?.length) {
                        for (const issue of result.issues) {
                            issues.push({
                                field: `initialResults.${index}${issue.field && issue.field !== '*' ? `.${issue.field}` : ''}`,
                                code: issue.code,
                                message: issue.message
                            });
                        }
                    }
                });

                const normalized = compactObject({
                    id,
                    space,
                    offsetRay,
                    entityTypes,
                    targetRaySpace,
                    handedness,
                    transient,
                    profile,
                    initialResults: initialResults.length ? initialResults : undefined
                });

                return { payload: normalized, issues };
            },
            fallback: {
                id: 'hit-test-ray',
                space: { type: 'viewer', id: null },
                offsetRay: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
                entityTypes: ['plane'],
                transient: false
            }
        });

        this.register('spatial.hit-test-result', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const rayId = this.ensureString(firstPresent([safe.rayId, safe.sourceId]), { field: 'rayId', allowEmpty: false, defaultValue: 'hit-test-ray', issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'local', issues });
                const pose = this.ensurePose(firstPresent([safe.pose, safe.transform, safe]), { field: 'pose', issues });
                const transformMatrix = this.ensureOptionalMatrix4(firstPresent([safe.transformMatrix, safe.matrix]), { field: 'transformMatrix', issues });
                const distance = this.ensureNumber(firstPresent([safe.distance, safe.hitDistance]), { field: 'distance', min: 0, max: 1000, defaultValue: 0, precision: 5, issues });
                const timestamp = this.ensureNumber(firstPresent([safe.timestamp, safe.time]), { field: 'timestamp', min: 0, defaultValue: 0, issues });
                const type = this.ensureOptionalEnum(firstPresent([safe.type, safe.entityType]), { field: 'type', allowed: HIT_TEST_RESULT_TYPES, defaultValue: 'unknown', issues });
                const normal = safe.normal ? this.ensureVector(safe.normal, { field: 'normal', min: -1, max: 1, defaultValue: 0, issues }) : undefined;
                const anchors = this.ensureStringArray(firstPresent([safe.anchors, safe.anchorIds]), { field: 'anchors', allowEmpty: true, issues });
                const confidence = this.ensureOptionalNumber(safe.confidence, { field: 'confidence', min: 0, max: 1, defaultValue: null, issues });
                const inputSource = isPlainObject(safe.inputSource)
                    ? compactObject({
                        handedness: this.ensureOptionalEnum(firstPresent([safe.inputSource.handedness, safe.handedness]), { field: 'inputSource.handedness', allowed: HANDEDNESS_VALUES, defaultValue: 'none', issues }),
                        targetRaySpace: this.ensureOptionalString(safe.inputSource.targetRaySpace, { field: 'inputSource.targetRaySpace', issues }),
                        profiles: this.ensureStringArray(safe.inputSource.profiles, { field: 'inputSource.profiles', allowEmpty: true, issues })
                    })
                    : undefined;

                const normalized = compactObject({
                    rayId,
                    space,
                    pose,
                    transformMatrix,
                    distance,
                    timestamp,
                    type,
                    normal,
                    anchors: anchors.length ? anchors : undefined,
                    inputSource,
                    confidence
                });

                return { payload: normalized, issues };
            },
            fallback: {
                rayId: 'hit-test-ray',
                space: { type: 'local', id: null },
                pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
                distance: 0,
                timestamp: 0,
                type: 'unknown'
            }
        });

        this.register('spatial.hit-test-results', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const timestamp = this.ensureNumber(firstPresent([safe.timestamp, safe.time]), { field: 'timestamp', min: 0, defaultValue: 0, issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'viewer', issues });
                const resultsSource = Array.isArray(safe.results) ? safe.results : [];
                const results = [];

                resultsSource.forEach((entry, index) => {
                    const result = this.validate('spatial.hit-test-result', entry);
                    results.push(result.payload);
                    if (result.issues?.length) {
                        for (const issue of result.issues) {
                            issues.push({
                                field: `results.${index}${issue.field && issue.field !== '*' ? `.${issue.field}` : ''}`,
                                code: issue.code,
                                message: issue.message
                            });
                        }
                    }
                });

                const normalized = compactObject({
                    timestamp,
                    space,
                    results
                });

                return { payload: normalized, issues };
            },
            fallback: { timestamp: 0, space: { type: 'viewer', id: null }, results: [] }
        });

        this.register('spatial.anchor', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const id = this.ensureString(firstPresent([safe.id, safe.anchorId]), { field: 'id', allowEmpty: false, defaultValue: 'anchor', issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'local', issues });
                const pose = this.ensurePose(firstPresent([safe.pose, safe.transform, safe]), { field: 'pose', issues });
                const lastChangedTime = this.ensureNumber(firstPresent([safe.lastChangedTime, safe.timestamp, safe.time]), { field: 'lastChangedTime', min: 0, defaultValue: 0, issues });
                const trackingState = this.ensureOptionalEnum(firstPresent([safe.trackingState, safe.state]), { field: 'trackingState', allowed: TRACKING_STATES, defaultValue: 'tracked', issues });
                const accuracy = this.ensureOptionalNumber(firstPresent([safe.accuracy, safe.error, safe.positionAccuracy]), { field: 'accuracy', min: 0, max: 5, defaultValue: null, precision: 4, issues });
                const associatedRayId = this.ensureOptionalString(firstPresent([safe.associatedRayId, safe.rayId]), { field: 'associatedRayId', issues });
                const classification = this.ensureOptionalEnum(firstPresent([safe.classification, safe.semanticLabel]), { field: 'classification', allowed: PLANE_CLASSIFICATIONS, defaultValue: 'unknown', issues });
                const confidence = this.ensureOptionalNumber(safe.confidence, { field: 'confidence', min: 0, max: 1, defaultValue: null, issues });

                const normalized = compactObject({
                    id,
                    space,
                    pose,
                    lastChangedTime,
                    trackingState,
                    accuracy,
                    associatedRayId,
                    classification,
                    confidence
                });

                return { payload: normalized, issues };
            },
            fallback: {
                id: 'anchor',
                space: { type: 'local', id: null },
                pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
                lastChangedTime: 0,
                trackingState: 'tracked'
            }
        });

        this.register('spatial.anchors', {
            normalize: payload => {
                const issues = [];
                const safe = isPlainObject(payload) ? payload : {};
                const timestamp = this.ensureNumber(firstPresent([safe.timestamp, safe.time]), { field: 'timestamp', min: 0, defaultValue: 0, issues });
                const space = this.ensureSpaceReference(firstPresent([safe.space, safe.referenceSpace]), { field: 'space', defaultType: 'local', issues });
                const anchorsSource = Array.isArray(safe.anchors) ? safe.anchors : [];
                const anchors = [];

                anchorsSource.forEach((entry, index) => {
                    const result = this.validate('spatial.anchor', entry);
                    anchors.push(result.payload);
                    if (result.issues?.length) {
                        for (const issue of result.issues) {
                            issues.push({
                                field: `anchors.${index}${issue.field && issue.field !== '*' ? `.${issue.field}` : ''}`,
                                code: issue.code,
                                message: issue.message
                            });
                        }
                    }
                });

                const removedIds = this.ensureStringArray(firstPresent([safe.removedIds, safe.removed, safe.deletedIds]), { field: 'removedIds', allowEmpty: true, issues });

                const normalized = compactObject({
                    timestamp,
                    space,
                    anchors,
                    removedIds: removedIds.length ? removedIds : undefined
                });

                return { payload: normalized, issues };
            },
            fallback: { timestamp: 0, space: { type: 'local', id: null }, anchors: [] }
        });
    }

    ensureNumber(value, { field, min = -Infinity, max = Infinity, defaultValue = 0, precision, issues } = {}) {
        let numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            numeric = defaultValue;
            issues?.push({ field, code: 'type', message: `${field} must be a finite number.` });
        }

        if (typeof min === 'number' && numeric < min) {
            issues?.push({ field, code: 'min', message: `${field} must be ≥ ${min}.` });
            numeric = min;
        }
        if (typeof max === 'number' && numeric > max) {
            issues?.push({ field, code: 'max', message: `${field} must be ≤ ${max}.` });
            numeric = max;
        }

        if (typeof precision === 'number' && Number.isFinite(precision) && precision >= 0) {
            const factor = 10 ** precision;
            numeric = Math.round(numeric * factor) / factor;
        }

        return numeric;
    }

    ensureOptionalNumber(value, options = {}) {
        if (value === undefined || value === null || value === '') {
            return options.defaultValue;
        }
        return this.ensureNumber(value, options);
    }

    ensureInteger(value, options = {}) {
        const numeric = this.ensureNumber(value, options);
        return Math.round(numeric);
    }

    ensureOptionalInteger(value, options = {}) {
        if (value === undefined || value === null || value === '') {
            return options.defaultValue;
        }
        return this.ensureInteger(value, options);
    }

    ensureBoolean(value, { field, defaultValue = false, issues } = {}) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (value === 'true' || value === 'false') {
            return value === 'true';
        }
        if (Number.isFinite(Number(value))) {
            return Boolean(Number(value));
        }
        issues?.push({ field, code: 'type', message: `${field} must be a boolean.` });
        return defaultValue;
    }

    ensureString(value, { field, allowEmpty = false, defaultValue = '', issues } = {}) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!allowEmpty && trimmed === '') {
                issues?.push({ field, code: 'empty', message: `${field} must not be empty.` });
                return defaultValue;
            }
            return trimmed;
        }

        if (value === undefined || value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            issues?.push({ field, code: 'missing', message: `${field} is required.` });
            return '';
        }

        if (typeof value.toString === 'function') {
            return this.ensureString(value.toString(), { field, allowEmpty, defaultValue, issues });
        }

        issues?.push({ field, code: 'type', message: `${field} must be a string.` });
        return defaultValue;
    }

    ensureOptionalString(value, options = {}) {
        if (value === undefined || value === null || value === '') {
            return options.defaultValue ?? null;
        }
        return this.ensureString(value, { ...options, allowEmpty: true });
    }

    ensureEnum(value, { field, allowed = [], defaultValue, issues, allowUndefined = false } = {}) {
        if ((value === undefined || value === null || value === '') && allowUndefined) {
            return defaultValue ?? allowed[0];
        }
        const normalized = this.ensureString(value, { field, allowEmpty: false, defaultValue: defaultValue ?? allowed[0], issues });
        if (allowed.length && !allowed.includes(normalized)) {
            issues?.push({ field, code: 'enum', message: `${field} must be one of: ${allowed.join(', ')}.` });
            return defaultValue ?? allowed[0];
        }
        return normalized;
    }

    ensureOptionalEnum(value, options = {}) {
        return this.ensureEnum(value, { ...options, allowUndefined: true });
    }

    ensureStringArray(value, { field, allowEmpty = true, issues } = {}) {
        if (value === undefined || value === null) {
            return [];
        }
        if (!Array.isArray(value)) {
            issues?.push({ field, code: 'type', message: `${field} must be an array.` });
            return [];
        }
        const normalized = value.map((entry, index) => this.ensureString(entry, { field: `${field}.${index}`, allowEmpty, defaultValue: '', issues }))
            .filter(entry => allowEmpty || entry !== '');
        return Array.from(new Set(normalized));
    }

    ensureEnumArray(value, { field, allowed = [], defaultValue, allowEmpty = true, issues } = {}) {
        if (!Array.isArray(value)) {
            if (value === undefined || value === null) {
                return allowEmpty ? [] : [defaultValue ?? allowed[0]];
            }
            issues?.push({ field, code: 'type', message: `${field} must be an array.` });
            return allowEmpty ? [] : [defaultValue ?? allowed[0]];
        }

        const normalized = [];
        value.forEach((entry, index) => {
            const result = this.ensureEnum(entry, { field: `${field}.${index}`, allowed, defaultValue: defaultValue ?? allowed[0], issues });
            if (!normalized.includes(result)) {
                normalized.push(result);
            }
        });

        if (!normalized.length && !allowEmpty) {
            normalized.push(defaultValue ?? allowed[0]);
        }

        return normalized;
    }

    ensurePose(value, { field = 'pose', issues } = {}) {
        const safe = isPlainObject(value) ? value : {};
        const positionSource = firstPresent([safe.position, safe.translation, safe.origin]);
        const orientationSource = firstPresent([safe.orientation, safe.rotation, safe.quaternion]);
        return {
            position: this.ensureVector(positionSource ?? {}, { field: `${field}.position`, defaultValue: 0, issues }),
            orientation: this.ensureQuaternion(orientationSource ?? {}, { field: `${field}.orientation`, issues })
        };
    }

    ensureSpaceReference(value, { field = 'space', defaultType = 'local', issues } = {}) {
        if (typeof value === 'string') {
            const type = this.ensureEnum(value, { field, allowed: SPATIAL_SPACE_TYPES, defaultValue: defaultType, issues });
            return { type, id: null };
        }

        if (!isPlainObject(value)) {
            issues?.push({ field, code: 'type', message: `${field} must be a space reference.` });
            return { type: defaultType, id: null };
        }

        const type = this.ensureEnum(firstPresent([value.type, value.referenceSpaceType, value.spaceType]), { field: `${field}.type`, allowed: SPATIAL_SPACE_TYPES, defaultValue: defaultType, issues });
        const idSource = firstPresent([value.id, value.spaceId]);
        const space = { type };
        if (idSource !== undefined && idSource !== null && idSource !== '') {
            space.id = this.ensureString(idSource, { field: `${field}.id`, allowEmpty: false, defaultValue: null, issues });
        } else {
            space.id = null;
        }

        if (value.pose) {
            space.pose = this.ensurePose(value.pose, { field: `${field}.pose`, issues });
        }

        return space;
    }

    ensureMatrix4(value, { field, issues } = {}) {
        if (!Array.isArray(value)) {
            issues?.push({ field, code: 'type', message: `${field} must be a 4x4 matrix array.` });
            return [...DEFAULT_MATRIX4];
        }

        const normalized = value.slice(0, 16).map((entry, index) => this.ensureNumber(entry, { field: `${field}.${index}`, defaultValue: DEFAULT_MATRIX4[index] ?? 0, issues }));
        if (normalized.length < 16) {
            for (let index = normalized.length; index < 16; index++) {
                normalized.push(DEFAULT_MATRIX4[index] ?? 0);
            }
            issues?.push({ field, code: 'length', message: `${field} must contain 16 entries.` });
        }
        return normalized;
    }

    ensureOptionalMatrix4(value, options = {}) {
        if (!value && value !== 0) {
            return null;
        }
        return this.ensureMatrix4(value, options);
    }

    ensureVectorArray(value, { field, minLength = 0, issues } = {}) {
        if (!Array.isArray(value)) {
            if (minLength > 0) {
                issues?.push({ field, code: 'type', message: `${field} must be an array of vectors.` });
            }
            return [];
        }

        const vectors = value.map((entry, index) => this.ensureVector(entry, { field: `${field}.${index}`, defaultValue: 0, issues }));
        if (minLength > 0 && vectors.length < minLength) {
            issues?.push({ field, code: 'length', message: `${field} must contain at least ${minLength} entries.` });
        }
        return vectors;
    }

    ensureRay(value, { field = 'offsetRay', issues } = {}) {
        const safe = isPlainObject(value) ? value : {};
        const origin = this.ensureVector(firstPresent([safe.origin, safe.position]) ?? {}, { field: `${field}.origin`, defaultValue: 0, issues });
        const direction = this.ensureVector(firstPresent([safe.direction, safe.vector]) ?? { z: -1 }, { field: `${field}.direction`, defaultValue: 0, issues });
        return { origin, direction };
    }

    ensureDepthBufferDescriptor(value, { field, issues } = {}) {
        if (value === undefined || value === null) {
            return { type: 'cpu', handle: null };
        }

        if (typeof value === 'string') {
            return { type: 'cpu', handle: value };
        }

        if (ArrayBuffer.isView(value)) {
            return { type: 'cpu', handle: '[inline]' };
        }

        if (!isPlainObject(value)) {
            issues?.push({ field, code: 'type', message: `${field} must be a buffer descriptor.` });
            return { type: 'cpu', handle: null };
        }

        const type = this.ensureEnum(firstPresent([value.type, value.kind]), { field: `${field}.type`, allowed: ['cpu', 'gpu'], defaultValue: 'cpu', issues });
        const handleSource = firstPresent([value.handle, value.id, value.reference]);
        const handle = handleSource !== undefined ? this.ensureString(handleSource, { field: `${field}.handle`, allowEmpty: true, defaultValue: null, issues }) : null;
        const format = value.format !== undefined ? this.ensureOptionalString(value.format, { field: `${field}.format`, issues }) : undefined;
        const usage = value.usage !== undefined ? this.ensureOptionalString(value.usage, { field: `${field}.usage`, issues }) : undefined;

        return compactObject({ type, handle, format, usage });
    }

    ensureCameraIntrinsics(value, { field, issues } = {}) {
        if (value === undefined || value === null) {
            return undefined;
        }

        if (!isPlainObject(value)) {
            issues?.push({ field, code: 'type', message: `${field} must be an object.` });
            return undefined;
        }

        const normalized = {};
        if (value.fx !== undefined) {
            normalized.fx = this.ensureNumber(value.fx, { field: `${field}.fx`, min: 0, max: 10000, defaultValue: 0, precision: 4, issues });
        }
        if (value.fy !== undefined) {
            normalized.fy = this.ensureNumber(value.fy, { field: `${field}.fy`, min: 0, max: 10000, defaultValue: 0, precision: 4, issues });
        }
        if (value.cx !== undefined) {
            normalized.cx = this.ensureNumber(value.cx, { field: `${field}.cx`, min: -10000, max: 10000, defaultValue: 0, precision: 4, issues });
        }
        if (value.cy !== undefined) {
            normalized.cy = this.ensureNumber(value.cy, { field: `${field}.cy`, min: -10000, max: 10000, defaultValue: 0, precision: 4, issues });
        }

        return Object.keys(normalized).length ? normalized : undefined;
    }

    ensureVector(value, { field, min = -Infinity, max = Infinity, defaultValue = 0, issues } = {}) {
        const safe = isPlainObject(value) ? value : {};
        return {
            x: this.ensureNumber(safe.x, { field: `${field}.x`, min, max, defaultValue, issues }),
            y: this.ensureNumber(safe.y, { field: `${field}.y`, min, max, defaultValue, issues }),
            z: this.ensureNumber(safe.z, { field: `${field}.z`, min, max, defaultValue, issues })
        };
    }

    ensureQuaternion(value, { field, issues } = {}) {
        const safe = isPlainObject(value) ? value : {};
        return {
            x: this.ensureNumber(safe.x, { field: `${field}.x`, min: -1, max: 1, defaultValue: 0, issues }),
            y: this.ensureNumber(safe.y, { field: `${field}.y`, min: -1, max: 1, defaultValue: 0, issues }),
            z: this.ensureNumber(safe.z, { field: `${field}.z`, min: -1, max: 1, defaultValue: 0, issues }),
            w: this.ensureNumber(safe.w, { field: `${field}.w`, min: -1, max: 1, defaultValue: 1, issues })
        };
    }
}

