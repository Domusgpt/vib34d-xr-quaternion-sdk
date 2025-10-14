const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) return value;
    if (typeof min === 'number' && value < min) return min;
    if (typeof max === 'number' && value > max) return max;
    return value;
};

const clampConfidence = (value, fallback = 0.75) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return clamp(fallback, 0, 1);
    }
    return clamp(numeric, 0, 1);
};

const clone = value => {
    if (value == null || typeof value !== 'object') {
        return value ?? null;
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (error) {
            // Fall back to JSON copy below
        }
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return { ...value };
    }
};

const compactObject = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    const entries = Object.entries(value)
        .map(([key, entryValue]) => {
            if (entryValue == null) {
                return null;
            }
            if (typeof entryValue === 'object' && !Array.isArray(entryValue)) {
                const compacted = compactObject(entryValue);
                if (compacted == null) {
                    return null;
                }
                if (typeof compacted === 'object' && Object.keys(compacted).length === 0) {
                    return null;
                }
                return [key, compacted];
            }
            if (Array.isArray(entryValue) && entryValue.length === 0) {
                return null;
            }
            return [key, entryValue];
        })
        .filter(Boolean);

    if (entries.length === 0) {
        return null;
    }

    return Object.fromEntries(entries);
};

const compactChannels = (channels, fallbackConfidence) => {
    if (!channels || typeof channels !== 'object') {
        return {};
    }
    const normalized = {};
    for (const [type, channel] of Object.entries(channels)) {
        if (!channel) continue;
        const payload = channel.payload && typeof channel.payload === 'object'
            ? { ...channel.payload }
            : (channel.payload ?? {});
        normalized[type] = {
            payload,
            confidence: clampConfidence(channel.confidence, fallbackConfidence)
        };
    }
    return normalized;
};

const summarizeMetadata = metadata => {
    if (!metadata || typeof metadata !== 'object') {
        return undefined;
    }
    const summary = {};
    if (metadata.batteryLevel !== undefined) summary.batteryLevel = metadata.batteryLevel;
    if (metadata.deviceTemperature !== undefined) summary.deviceTemperature = metadata.deviceTemperature;
    if (metadata.skinContact !== undefined) summary.skinContact = metadata.skinContact;
    if (metadata.signalQuality) summary.signalQuality = metadata.signalQuality;
    if (metadata.uptimeSeconds !== undefined) summary.uptimeSeconds = metadata.uptimeSeconds;
    if (metadata.fieldOfView) summary.fieldOfView = metadata.fieldOfView;
    return Object.keys(summary).length > 0 ? summary : undefined;
};

export class BaseWearableDeviceAdapter {
    constructor(options = {}) {
        const {
            deviceId = 'wearable-device',
            firmwareVersion = null,
            telemetry = null,
            telemetryScope = 'sensors.adapter',
            telemetryClassification = 'system',
            licenseManager = null,
            requiredLicenseFeature = null,
            schemaType = 'wearable.generic',
            defaultConfidence = 0.75,
            sampleProvider,
            transport = null,
            trace,
            traceLoop = true,
            recordTelemetryMetadata = true
        } = options;

        this.deviceId = deviceId;
        this.firmwareVersion = firmwareVersion;
        this.telemetry = telemetry;
        this.telemetryScope = telemetryScope;
        this.telemetryClassification = telemetryClassification;
        this.licenseManager = licenseManager;
        this.requiredLicenseFeature = requiredLicenseFeature;
        this.schemaType = schemaType;
        this.defaultConfidence = defaultConfidence;
        this.transport = transport || null;
        this.recordTelemetryMetadata = recordTelemetryMetadata;

        this.trace = Array.isArray(trace) ? [...trace] : null;
        this.traceLoop = traceLoop !== false;
        this.traceIndex = 0;

        this.sampleProvider = typeof sampleProvider === 'function'
            ? sampleProvider
            : this.createDefaultSampleProvider();

        this.connected = false;
        this.lastLicenseBlock = null;
    }

    createDefaultSampleProvider() {
        if (this.transport) {
            return async () => {
                if (typeof this.transport.nextSample === 'function') {
                    return this.transport.nextSample();
                }
                if (typeof this.transport.read === 'function') {
                    return this.transport.read();
                }
                return null;
            };
        }

        if (!this.trace) {
            return async () => null;
        }

        return async () => {
            if (!this.trace.length) {
                return null;
            }
            if (this.traceIndex >= this.trace.length) {
                if (!this.traceLoop) {
                    return null;
                }
                this.traceIndex = 0;
            }
            const entry = this.trace[this.traceIndex++];
            if (typeof entry === 'function') {
                return entry();
            }
            if (!entry || typeof entry !== 'object') {
                return entry ?? null;
            }
            return clone(entry);
        };
    }

    async connect() {
        const permitted = await this.ensureLicense();
        if (!permitted) {
            this.recordAudit('license_blocked', { reason: 'status', status: this.licenseManager?.getStatus?.() ?? null });
            return;
        }

        if (this.transport?.connect) {
            await this.transport.connect();
        }

        this.resetTrace();
        this.connected = true;
        this.track('connected', { status: 'connected' });
    }

    async disconnect() {
        if (this.transport?.disconnect) {
            await this.transport.disconnect();
        }
        this.connected = false;
        this.track('disconnected', { status: 'disconnected' });
    }

    async read() {
        if (!this.connected) {
            await this.connect();
            if (!this.connected) {
                return null;
            }
        }

        const permitted = await this.ensureLicense();
        if (!permitted) {
            this.recordAudit('license_blocked', { reason: 'status', status: this.licenseManager?.getStatus?.() ?? null });
            return null;
        }

        const raw = await this.sampleProvider();
        if (!raw) {
            return null;
        }

        const normalized = this.normalizeSample(raw);
        if (!normalized || typeof normalized !== 'object') {
            return null;
        }

        const confidence = clampConfidence(normalized.confidence, this.defaultConfidence);
        const payload = this.decoratePayload(normalized.payload || {});

        this.track('sample', {
            confidence,
            channels: Object.keys(payload.channels || {}),
            metadata: this.recordTelemetryMetadata ? summarizeMetadata(payload.metadata) : undefined
        });

        return { confidence, payload };
    }

    normalizeSample(raw) {
        return {
            confidence: this.defaultConfidence,
            payload: raw
        };
    }

    decoratePayload(payload) {
        const base = payload && typeof payload === 'object' ? { ...payload } : {};
        if (!base.deviceId) {
            base.deviceId = this.deviceId;
        }
        if (base.firmwareVersion == null && this.firmwareVersion != null) {
            base.firmwareVersion = this.firmwareVersion;
        }
        if (base.channels) {
            base.channels = compactChannels(base.channels, this.defaultConfidence);
        }
        if (base.metadata) {
            const compacted = compactObject(base.metadata);
            base.metadata = compacted || {};
        }
        return base;
    }

    async ensureLicense() {
        if (!this.licenseManager) {
            return true;
        }

        let status = typeof this.licenseManager.getStatus === 'function'
            ? this.licenseManager.getStatus()
            : null;

        if (!status || status.state !== 'valid') {
            if (typeof this.licenseManager.validate === 'function') {
                try {
                    status = await this.licenseManager.validate({
                        scope: this.schemaType,
                        deviceId: this.deviceId
                    });
                } catch (error) {
                    this.noteLicenseBlock('validation', { error: error?.message || 'validation_failed' });
                    return false;
                }
            }
        }

        if (!status || status.state !== 'valid') {
            this.noteLicenseBlock('status', { status });
            return false;
        }

        if (this.requiredLicenseFeature) {
            try {
                if (typeof this.licenseManager.requireFeature === 'function') {
                    this.licenseManager.requireFeature(this.requiredLicenseFeature);
                } else if (typeof this.licenseManager.hasFeature === 'function') {
                    if (!this.licenseManager.hasFeature(this.requiredLicenseFeature)) {
                        const error = new Error(`License missing feature: ${this.requiredLicenseFeature}`);
                        error.code = 'LICENSE_FEATURE_MISSING';
                        throw error;
                    }
                }
            } catch (error) {
                this.noteLicenseBlock('feature', {
                    status,
                    feature: this.requiredLicenseFeature,
                    error: error?.message,
                    code: error?.code
                });
                return false;
            }
        }

        this.lastLicenseBlock = null;
        return true;
    }

    noteLicenseBlock(reason, details) {
        const payload = {
            reason,
            ...(details && typeof details === 'object' ? details : { details })
        };
        const snapshot = JSON.stringify(payload);
        if (snapshot === this.lastLicenseBlock) {
            return;
        }
        this.lastLicenseBlock = snapshot;
        this.recordAudit('license_blocked', payload);
    }

    recordAudit(eventSuffix, payload) {
        if (!this.telemetry?.recordAudit) {
            return;
        }
        this.telemetry.recordAudit(
            `${this.telemetryScope}.${this.schemaType}.${eventSuffix}`,
            {
                deviceId: this.deviceId,
                firmwareVersion: this.firmwareVersion ?? undefined,
                ...payload
            }
        );
    }

    track(eventSuffix, payload) {
        if (!this.telemetry?.track) {
            return;
        }
        this.telemetry.track(
            `${this.telemetryScope}.${this.schemaType}.${eventSuffix}`,
            {
                deviceId: this.deviceId,
                firmwareVersion: this.firmwareVersion ?? undefined,
                ...payload
            },
            { classification: this.telemetryClassification }
        );
    }

    resetTrace() {
        this.traceIndex = 0;
        if (this.transport?.reset) {
            this.transport.reset();
        }
    }
}

