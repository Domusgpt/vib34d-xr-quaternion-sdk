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

const ensureConfidence = (value, fallback) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric;
    }
    return fallback;
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

export class BiometricWristWearableAdapter extends BaseWearableDeviceAdapter {
    constructor(options = {}) {
        super({
            schemaType: 'wearable.biometric-wrist',
            requiredLicenseFeature: options.requiredLicenseFeature || 'wearables-biometric',
            defaultConfidence: options.defaultConfidence ?? 0.78,
            ...options
        });
    }

    normalizeSample(raw = {}) {
        const safe = isPlainObject(raw) ? raw : {};
        const composite = {
            deviceId: safe.deviceId ?? this.deviceId,
            firmwareVersion: pickFirst(safe, ['firmwareVersion', 'metadata.firmwareVersion']) ?? this.firmwareVersion ?? null,
            channels: {},
            metadata: {}
        };

        const vitalsSource = pickFirst(safe, ['channels.biometric', 'vitals', 'biometric']);
        if (vitalsSource) {
            const payload = cloneChannelPayload(vitalsSource);
            const confidence = firstNumber(
                vitalsSource.confidence,
                getPath(safe, 'quality.vitals'),
                getPath(safe, 'quality.overall')
            );
            composite.channels.biometric = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence)
            };
        }

        const ambientSource = pickFirst(safe, ['channels.ambient', 'environment']);
        if (ambientSource) {
            const payload = cloneChannelPayload(ambientSource);
            const confidence = firstNumber(
                ambientSource.confidence,
                getPath(safe, 'quality.environment'),
                getPath(safe, 'quality.motion')
            );
            composite.channels.ambient = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence * 0.75)
            };
        }

        assignIfDefined(
            composite.metadata,
            'batteryLevel',
            firstNumber(safe.batteryLevel, getPath(safe, 'metadata.batteryLevel'))
        );
        if (safe.skinContact !== undefined || getPath(safe, 'metadata.skinContact') !== undefined) {
            const value = pickFirst(safe, ['skinContact', 'metadata.skinContact']);
            composite.metadata.skinContact = Boolean(value);
        }
        assignIfDefined(composite.metadata, 'lastSync', pickFirst(safe, ['lastSync', 'metadata.lastSync']));

        const motion = pickFirst(safe, ['metadata.motion', 'motion']);
        if (isPlainObject(motion)) {
            composite.metadata.motion = {};
            if (isPlainObject(motion.acceleration)) {
                composite.metadata.motion.acceleration = { ...motion.acceleration };
            }
        }

        assignIfDefined(
            composite.metadata,
            'deviceTemperature',
            firstNumber(safe.deviceTemperature, getPath(safe, 'metadata.deviceTemperature'))
        );

        const alerts = pickFirst(safe, ['metadata.alerts', 'alerts']);
        if (Array.isArray(alerts)) {
            const sanitized = alerts
                .filter(value => typeof value === 'string' && value.trim().length > 0)
                .map(value => value.trim());
            if (sanitized.length) {
                composite.metadata.alerts = sanitized;
            }
        }

        if (Object.keys(composite.metadata).length === 0) {
            delete composite.metadata;
        }

        for (const channel of Object.values(composite.channels)) {
            if (channel.confidence === undefined) {
                channel.confidence = this.defaultConfidence;
            }
        }

        const confidence = ensureConfidence(
            firstNumber(
                safe.confidence,
                getPath(safe, 'quality.overall'),
                composite.channels.biometric?.confidence
            ),
            this.defaultConfidence
        );

        return {
            confidence,
            payload: composite
        };
    }
}

