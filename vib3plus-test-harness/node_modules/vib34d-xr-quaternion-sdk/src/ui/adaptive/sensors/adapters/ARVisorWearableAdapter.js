import { BaseWearableDeviceAdapter } from './BaseWearableDeviceAdapter.js';

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getPath = (source, path) => {
    if (!path) return undefined;
    const parts = String(path).split('.');
    let current = source;
    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return undefined;
        }
        current = current[part];
    }
    return current;
};

const pickFirst = (source, paths) => {
    for (const path of paths) {
        const value = getPath(source, path);
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
};

const cloneChannelPayload = value => {
    if (!isPlainObject(value)) {
        return {};
    }
    if (isPlainObject(value.payload)) {
        return { ...value.payload };
    }
    const { confidence, ...rest } = value;
    return { ...rest };
};

const firstNumber = (...candidates) => {
    for (const candidate of candidates) {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return undefined;
};

const assignIfDefined = (target, key, value, clone = false) => {
    if (value === undefined || value === null) {
        return;
    }
    if (clone && isPlainObject(value)) {
        target[key] = { ...value };
        return;
    }
    target[key] = value;
};

const ensureConfidence = (value, fallback) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (numeric < 0) return 0;
        if (numeric > 1) return 1;
        return numeric;
    }
    const fallbackNumeric = Number(fallback);
    if (!Number.isFinite(fallbackNumeric)) {
        return 0;
    }
    if (fallbackNumeric < 0) return 0;
    if (fallbackNumeric > 1) return 1;
    return fallbackNumeric;
};

const deepCloneValue = value => {
    if (Array.isArray(value)) {
        return value.map(entry => deepCloneValue(entry));
    }
    if (isPlainObject(value)) {
        const clone = {};
        for (const [key, entry] of Object.entries(value)) {
            clone[key] = deepCloneValue(entry);
        }
        return clone;
    }
    return value;
};

const unwrapSpatialSource = (source, arrayKey) => {
    if (!source) {
        return null;
    }

    if (Array.isArray(source)) {
        if (!arrayKey) {
            return null;
        }
        return {
            payload: {
                [arrayKey]: source.map(entry => deepCloneValue(entry))
            }
        };
    }

    if (!isPlainObject(source)) {
        return null;
    }

    if (isPlainObject(source.payload)) {
        return {
            payload: deepCloneValue(source.payload),
            confidence: source.confidence
        };
    }

    const { confidence, ...rest } = source;
    if (arrayKey && Array.isArray(rest)) {
        return {
            payload: {
                [arrayKey]: rest.map(entry => deepCloneValue(entry))
            },
            confidence
        };
    }

    return {
        payload: deepCloneValue(rest),
        confidence
    };
};

const hasSpatialPayload = payload => {
    if (!payload) {
        return false;
    }
    if (Array.isArray(payload)) {
        return payload.length > 0;
    }
    if (isPlainObject(payload)) {
        return Object.keys(payload).length > 0;
    }
    return true;
};

export class ARVisorWearableAdapter extends BaseWearableDeviceAdapter {
    constructor(options = {}) {
        super({
            schemaType: 'wearable.ar-visor',
            requiredLicenseFeature: options.requiredLicenseFeature || 'wearables-ar-visor',
            defaultConfidence: options.defaultConfidence ?? 0.82,
            ...options
        });

        this.defaultFieldOfView = {
            horizontal: 96,
            vertical: 89,
            diagonal: 110,
            ...(options.defaultFieldOfView || {})
        };
    }

    normalizeSample(raw = {}) {
        const safe = isPlainObject(raw) ? raw : {};
        const composite = {
            deviceId: safe.deviceId ?? this.deviceId,
            firmwareVersion: pickFirst(safe, ['firmwareVersion', 'metadata.firmwareVersion']) ?? this.firmwareVersion ?? null,
            channels: {},
            metadata: {}
        };

        const gazeSource = pickFirst(safe, ['channels.eye-tracking', 'gaze', 'focus']);
        if (gazeSource) {
            const payload = cloneChannelPayload(gazeSource);
            const confidence = firstNumber(
                gazeSource.confidence,
                safe.focusConfidence,
                getPath(safe, 'quality.focus')
            );
            composite.channels['eye-tracking'] = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence)
            };
        }

        const ambientSource = pickFirst(safe, ['channels.ambient', 'environment']);
        if (ambientSource) {
            const payload = cloneChannelPayload(ambientSource);
            const confidence = firstNumber(
                ambientSource.confidence,
                getPath(safe, 'quality.environment')
            );
            composite.channels.ambient = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence * 0.8)
            };
        }

        const gestureSource = pickFirst(safe, ['channels.gesture', 'gesture']);
        if (gestureSource) {
            const payload = cloneChannelPayload(gestureSource);
            const confidence = firstNumber(
                gestureSource.confidence,
                getPath(safe, 'quality.gesture'),
                getPath(safe, 'quality.focus')
            );
            composite.channels.gesture = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence * 0.75)
            };
        }

        const spatialChannels = {};
        const spatialConfidences = [];
        const addSpatialChannel = (key, paths, fallbackConfidence, confidencePaths = [], arrayKey) => {
            const rawSource = pickFirst(safe, paths);
            if (!rawSource) {
                return;
            }

            const entry = unwrapSpatialSource(rawSource, arrayKey);
            if (!entry || !hasSpatialPayload(entry.payload)) {
                return;
            }

            const confidence = ensureConfidence(
                firstNumber(
                    entry.confidence,
                    ...confidencePaths.map(path => getPath(safe, path)),
                    getPath(safe, 'spatial.confidence'),
                    getPath(safe, 'scene.confidence'),
                    getPath(safe, 'quality.scene.overall'),
                    getPath(safe, 'quality.scene'),
                    getPath(safe, 'quality.sceneConfidence'),
                    getPath(safe, 'sceneConfidence'),
                    getPath(safe, 'quality.overall')
                ),
                fallbackConfidence
            );

            spatialChannels[key] = {
                payload: entry.payload,
                confidence
            };
            spatialConfidences.push(confidence);
        };

        addSpatialChannel(
            'planes',
            ['channels.spatial.planes', 'spatial.planes', 'scene.planes'],
            0.78,
            [
                'spatial.planes.confidence',
                'scene.planes.confidence',
                'scene.planesConfidence',
                'quality.scene.planes',
                'quality.scene.planes.confidence',
                'quality.scenePlanes',
                'planesConfidence'
            ],
            'planes'
        );

        addSpatialChannel(
            'depth',
            ['channels.spatial.depth', 'spatial.depth', 'scene.depth'],
            0.72,
            [
                'spatial.depth.confidence',
                'scene.depth.confidence',
                'scene.depthConfidence',
                'quality.scene.depth',
                'quality.scene.depth.confidence',
                'quality.sceneDepth',
                'depthConfidence'
            ]
        );

        addSpatialChannel(
            'hitTests',
            ['channels.spatial.hitTests', 'spatial.hitTests', 'scene.hitTests'],
            0.8,
            [
                'spatial.hitTests.confidence',
                'scene.hitTests.confidence',
                'scene.hitTestConfidence',
                'quality.scene.hitTests',
                'quality.scene.hitTests.confidence',
                'quality.hitTests',
                'hitTestConfidence'
            ],
            'results'
        );

        addSpatialChannel(
            'anchors',
            ['channels.spatial.anchors', 'spatial.anchors', 'scene.anchors'],
            0.76,
            [
                'spatial.anchors.confidence',
                'scene.anchors.confidence',
                'scene.anchorConfidence',
                'quality.scene.anchors',
                'quality.scene.anchors.confidence',
                'quality.anchors',
                'anchorConfidence'
            ],
            'anchors'
        );

        if (Object.keys(spatialChannels).length > 0) {
            composite.spatial = spatialChannels;
        }

        const fieldOfView = {
            ...this.defaultFieldOfView,
            ...(pickFirst(safe, ['metadata.fieldOfView', 'fieldOfView']) || {})
        };
        if (Object.keys(fieldOfView).length) {
            composite.metadata.fieldOfView = fieldOfView;
        }

        const pose = pickFirst(safe, ['metadata.pose', 'pose']);
        if (isPlainObject(pose)) {
            const normalizedPose = {};
            if (isPlainObject(pose.orientation)) {
                normalizedPose.orientation = { ...pose.orientation };
            }
            if (isPlainObject(pose.position)) {
                normalizedPose.position = { ...pose.position };
            }
            if (Object.keys(normalizedPose).length) {
                composite.metadata.pose = normalizedPose;
            }
        }

        assignIfDefined(
            composite.metadata,
            'batteryLevel',
            firstNumber(safe.batteryLevel, getPath(safe, 'metadata.batteryLevel'))
        );
        assignIfDefined(
            composite.metadata,
            'deviceTemperature',
            firstNumber(
                safe.deviceTemperature,
                getPath(safe, 'metadata.deviceTemperature'),
                getPath(safe, 'environment.temperature')
            )
        );
        assignIfDefined(
            composite.metadata,
            'uptimeSeconds',
            firstNumber(safe.uptimeSeconds, getPath(safe, 'metadata.uptimeSeconds'))
        );
        assignIfDefined(composite.metadata, 'optics', pickFirst(safe, ['metadata.optics', 'optics']), true);

        if (Object.keys(composite.metadata).length === 0) {
            delete composite.metadata;
        }

        for (const channel of Object.values(composite.channels)) {
            if (channel.confidence === undefined) {
                channel.confidence = this.defaultConfidence;
            }
        }

        const channelConfidences = Object.values(composite.channels)
            .map(channel => channel?.confidence);

        const confidence = ensureConfidence(
            firstNumber(
                safe.confidence,
                getPath(safe, 'quality.overall'),
                getPath(safe, 'quality.overallConfidence'),
                getPath(safe, 'quality.focus'),
                getPath(safe, 'quality.scene'),
                getPath(safe, 'quality.scene.overall'),
                ...channelConfidences,
                ...spatialConfidences
            ),
            this.defaultConfidence
        );

        return {
            confidence,
            payload: composite
        };
    }
}

