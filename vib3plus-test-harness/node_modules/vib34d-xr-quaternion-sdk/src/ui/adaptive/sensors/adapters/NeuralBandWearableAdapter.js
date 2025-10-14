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

const cloneArray = value => Array.isArray(value) ? [...value] : undefined;

export class NeuralBandWearableAdapter extends BaseWearableDeviceAdapter {
    constructor(options = {}) {
        super({
            schemaType: 'wearable.neural-band',
            requiredLicenseFeature: options.requiredLicenseFeature || 'wearables-neural-band',
            defaultConfidence: options.defaultConfidence ?? 0.7,
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

        const intentSource = pickFirst(safe, ['channels.neural-intent', 'intent', 'signal']);
        if (intentSource) {
            const payload = cloneChannelPayload(intentSource);
            const confidence = firstNumber(
                intentSource.confidence,
                getPath(safe, 'signalQuality.overall'),
                getPath(safe, 'quality.intent')
            );
            composite.channels['neural-intent'] = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence)
            };
        }

        const gestureSource = pickFirst(safe, ['channels.gesture', 'gesture']);
        if (gestureSource) {
            const payload = cloneChannelPayload(gestureSource);
            const confidence = firstNumber(
                gestureSource.confidence,
                getPath(safe, 'quality.gesture')
            );
            composite.channels.gesture = {
                payload,
                confidence: ensureConfidence(confidence, this.defaultConfidence * 0.75)
            };
        }

        const signalQuality = pickFirst(safe, ['metadata.signalQuality', 'signalQuality']);
        if (isPlainObject(signalQuality)) {
            composite.metadata.signalQuality = { ...signalQuality };
            if (Array.isArray(signalQuality.contacts)) {
                composite.metadata.signalQuality.contacts = cloneArray(signalQuality.contacts);
            }
        }

        const impedance = pickFirst(safe, ['metadata.impedance', 'impedance']);
        if (isPlainObject(impedance)) {
            composite.metadata.impedance = { ...impedance };
        }

        const contactState = pickFirst(safe, ['metadata.contact.state', 'contactState']);
        const electrodes = pickFirst(safe, ['metadata.contact.electrodes', 'electrodes']);
        if (contactState !== undefined || electrodes !== undefined) {
            composite.metadata.contact = {};
            if (contactState !== undefined) {
                composite.metadata.contact.state = contactState;
            }
            if (Array.isArray(electrodes)) {
                composite.metadata.contact.electrodes = cloneArray(electrodes);
            }
        }

        const band = pickFirst(safe, ['metadata.band', 'band']);
        if (isPlainObject(band)) {
            composite.metadata.band = { ...band };
        }

        const temperature = firstNumber(safe.temperature, getPath(safe, 'metadata.deviceTemperature'));
        if (temperature !== undefined) {
            composite.metadata.deviceTemperature = temperature;
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
                getPath(safe, 'signalQuality.overall'),
                getPath(safe, 'quality.overall'),
                composite.channels['neural-intent']?.confidence
            ),
            this.defaultConfidence
        );

        return {
            confidence,
            payload: composite
        };
    }
}

