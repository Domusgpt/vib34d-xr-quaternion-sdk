/**
 * SensoryInputBridge
 * ------------------------------------------------------------
 * Normalizes heterogeneous sensor and intent signals (eye tracking, neural
 * gestures, biometrics, ambient context) into a common semantic layer that the
 * adaptive interface engine can consume. Designed to be extended with
 * wearables-specific adapters and remote data streams.
 */

import { SensorSchemaRegistry } from './sensors/SensorSchemaRegistry.js';

const deepClone = value => {
    if (value == null || typeof value !== 'object') {
        return value ?? null;
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (error) {
            // Fallback to JSON copy below
        }
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        if (Array.isArray(value)) {
            return value.map(entry => deepClone(entry));
        }
        return { ...value };
    }
};

export class SensoryInputBridge {
    constructor(options = {}) {
        const {
            pollingInterval = 16,
            decayHalfLife = 2800,
            confidenceThreshold = 0.35,
            schemaRegistry,
            schemas,
            issueReporter,
            autoConnectAdapters = true,
            validationLogLimit = 120,
            timeSource,
            channelHistoryLimit = 12,
            wearableHistoryLimit
        } = options;

        this.pollingInterval = pollingInterval;
        this.decayHalfLife = decayHalfLife;
        this.confidenceThreshold = confidenceThreshold;

        if (schemaRegistry instanceof SensorSchemaRegistry) {
            this.schemaRegistry = schemaRegistry;
        } else {
            this.schemaRegistry = new SensorSchemaRegistry({ schemas });
        }

        this.channels = new Map();
        this.subscribers = new Map();
        this.adapters = new Map();
        this.decayTimers = new Map();
        this.adapterStates = new Map();
        this.channelHistoryLimit = Math.max(0, Number(channelHistoryLimit) || 0);
        this.wearableHistoryLimit = Math.max(0, Number(wearableHistoryLimit ?? this.channelHistoryLimit) || 0);
        this.wearableSnapshots = new Map();
        this.wearableHistory = new Map();

        const fallbackTimeSource = () => {
            if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
                return performance.now();
            }
            return Date.now();
        };
        this.getNow = typeof timeSource === 'function' ? timeSource : fallbackTimeSource;

        this.state = {
            focusVector: { x: 0.5, y: 0.5, depth: 0.3 },
            intentionVector: { x: 0, y: 0, z: 0, w: 0 },
            engagementLevel: 0.4,
            biometricStress: 0.2,
            gestureIntent: null,
            environment: {
                luminance: 0.5,
                noiseLevel: 0.2,
                motion: 0.1
            },
            updatedAt: this.getNow()
        };

        this.loopHandle = null;
        this.autoConnectAdapters = autoConnectAdapters;
        this.validationReporter = typeof issueReporter === 'function' ? issueReporter : null;
        this.validationLog = [];
        this.validationLogLimit = validationLogLimit;
    }

    /**
     * Registers a new sensor adapter. Adapters must implement a `read()` method
     * that resolves with `{ confidence, payload }`.
     */
    registerAdapter(type, adapter) {
        this.adapters.set(type, adapter);
        if (!this.channels.has(type)) {
            this.channels.set(type, []);
        }
        this.adapterStates.set(type, { status: 'registered', lastError: null });
    }

    async connectAdapter(type) {
        const adapter = this.adapters.get(type);
        if (!adapter) {
            throw new Error(`No adapter registered for ${type}`);
        }

        if (typeof adapter.connect === 'function') {
            try {
                await adapter.connect();
                this.adapterStates.set(type, { status: 'connected', lastError: null });
                this.emit('adapter:connected', { type, timestamp: this.getNow() });
            } catch (error) {
                this.adapterStates.set(type, { status: 'error', lastError: error });
                this.emit('adapter:error', { type, error, timestamp: this.getNow() });
                throw error;
            }
        } else {
            this.adapterStates.set(type, { status: 'ready', lastError: null });
        }
    }

    async disconnectAdapter(type) {
        const adapter = this.adapters.get(type);
        if (!adapter) {
            throw new Error(`No adapter registered for ${type}`);
        }

        if (typeof adapter.disconnect === 'function') {
            try {
                await adapter.disconnect();
                this.adapterStates.set(type, { status: 'disconnected', lastError: null });
                this.emit('adapter:disconnected', { type, timestamp: this.getNow() });
            } catch (error) {
                this.adapterStates.set(type, { status: 'error', lastError: error });
                this.emit('adapter:error', { type, error, timestamp: this.getNow() });
                throw error;
            }
        } else {
            this.adapterStates.set(type, { status: 'ready', lastError: null });
        }
    }

    async testAdapter(type) {
        const adapter = this.adapters.get(type);
        if (!adapter) {
            throw new Error(`No adapter registered for ${type}`);
        }

        if (typeof adapter.test === 'function') {
            return adapter.test();
        }

        if (typeof adapter.read === 'function') {
            const sample = await adapter.read();
            return Boolean(sample);
        }

        return false;
    }

    async connectAllAdapters() {
        const promises = [];
        for (const type of this.adapters.keys()) {
            promises.push(this.connectAdapter(type).catch(() => {}));
        }
        await Promise.all(promises);
    }

    async disconnectAllAdapters() {
        const promises = [];
        for (const type of this.adapters.keys()) {
            promises.push(this.disconnectAdapter(type).catch(() => {}));
        }
        await Promise.all(promises);
    }

    /**
     * Subscribe to semantic updates.
     */
    subscribe(channel, callback) {
        if (!this.subscribers.has(channel)) {
            this.subscribers.set(channel, new Set());
        }
        this.subscribers.get(channel).add(callback);
        return () => this.unsubscribe(channel, callback);
    }

    unsubscribe(channel, callback) {
        const set = this.subscribers.get(channel);
        if (!set) return;
        set.delete(callback);
    }

    /**
     * Manual ingestion hook for environments that push data instead of polling.
     */
    ingest(type, payload, confidence = 1) {
        this.processSample(type, { confidence, payload });
    }

    /**
     * Begin continuous polling of registered adapters.
     */
    start() {
        if (this.loopHandle) return;
        if (this.autoConnectAdapters) {
            this.connectAllAdapters().catch(error => {
                console.warn('[SensoryInputBridge] Failed to auto-connect adapters', error);
            });
        }
        const loop = async () => {
            for (const [type, adapter] of this.adapters) {
                try {
                    const sample = await adapter.read();
                    if (sample) {
                        this.processSample(type, sample);
                    }
                } catch (error) {
                    console.warn(`[SensoryInputBridge] Adapter read failed for ${type}`, error);
                }
            }
            this.loopHandle = setTimeout(loop, this.pollingInterval);
        };
        loop();
    }

    stop() {
        if (this.loopHandle) {
            clearTimeout(this.loopHandle);
            this.loopHandle = null;
        }
        if (this.autoConnectAdapters) {
            this.disconnectAllAdapters().catch(error => {
                console.warn('[SensoryInputBridge] Failed to auto-disconnect adapters', error);
            });
        }
    }

    processSample(type, sample) {
        if (!sample) return;

        const numericConfidence = Number(sample.confidence);
        if (!Number.isFinite(numericConfidence)) return;

        const confidence = Math.max(0, Math.min(1, numericConfidence));
        if (confidence < this.confidenceThreshold) return;

        const now = this.getNow();
        const { payload: sanitizedPayload, issues } = this.schemaRegistry.validate(type, sample.payload);

        if (issues.length > 0) {
            console.warn(`[SensoryInputBridge] Schema validation issues for ${type}`, issues);
            this.validationLog.push({ type, issues, timestamp: now, payload: sanitizedPayload });
            if (this.validationLog.length > this.validationLogLimit) {
                this.validationLog.shift();
            }
            if (this.validationReporter) {
                try {
                    this.validationReporter({ type, issues, payload: sanitizedPayload, timestamp: now });
                } catch (error) {
                    console.error('[SensoryInputBridge] validation reporter failed', error);
                }
            }
            this.emit('schema:issue', { type, issues, timestamp: now, payload: sanitizedPayload });
        }

        if (!this.channels.has(type)) {
            this.channels.set(type, []);
        }
        const channelEntries = this.channels.get(type);
        channelEntries?.push({
            ...sample,
            confidence,
            payload: sanitizedPayload,
            issues,
            receivedAt: now
        });
        this.trimHistory(channelEntries);
        this.applySemanticMapping(type, sanitizedPayload, confidence, now);
    }

    applySemanticMapping(type, payload, confidence, timestamp) {
        if (typeof type === 'string' && type.startsWith('wearable.')) {
            this.emit(type, { payload, confidence, timestamp });
            this.applyWearableComposite(type, payload, confidence, timestamp);
            return;
        }

        switch (type) {
            case 'spatial.pose': {
                const adjustedConfidence = this.computeSpatialPoseConfidence(confidence, payload);
                this.emit(type, { payload, confidence: adjustedConfidence, timestamp });
                break;
            }
            case 'eye-tracking':
                this.updateFocus(payload, confidence, timestamp);
                break;
            case 'neural-intent':
                this.updateIntention(payload, confidence, timestamp);
                break;
            case 'biometric':
                this.updateBiometrics(payload, confidence, timestamp);
                break;
            case 'ambient':
                this.updateEnvironment(payload, confidence, timestamp);
                break;
            case 'gesture':
                this.updateGestures(payload, confidence, timestamp);
                break;
            default:
                // Allow custom adapters to emit semantic channel names directly
                this.emit(type, { payload, confidence, timestamp });
                break;
        }
    }

    computeSpatialPoseConfidence(confidence, payload) {
        const numericConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 1;
        if (!payload || typeof payload.confidence !== 'number') {
            return numericConfidence;
        }
        const hint = Math.max(0, Math.min(1, payload.confidence));
        return Math.min(numericConfidence, hint);
    }

    applyWearableComposite(type, payload, confidence, timestamp) {
        if (!payload || typeof payload !== 'object') return;

        const channels = payload.channels && typeof payload.channels === 'object'
            ? payload.channels
            : {};

        const compositeClone = deepClone(payload) || {};
        const deviceId = compositeClone.deviceId || 'wearable-device';

        for (const [channelType, channelValue] of Object.entries(channels)) {
            if (!channelValue) continue;
            const channelPayload = channelValue.payload ?? channelValue;
            const channelConfidence = typeof channelValue.confidence === 'number'
                ? channelValue.confidence
                : confidence;
            this.applySemanticMapping(channelType, channelPayload, channelConfidence, timestamp);
        }

        const metadata = payload.metadata && typeof payload.metadata === 'object'
            ? payload.metadata
            : null;
        if (metadata) {
            this.emit(`${type}:metadata`, {
                deviceId: payload.deviceId ?? null,
                firmwareVersion: payload.firmwareVersion ?? null,
                metadata,
                confidence,
                timestamp
            });
        }

        this.recordWearableSnapshot(type, {
            type,
            deviceId,
            confidence,
            timestamp,
            firmwareVersion: compositeClone.firmwareVersion ?? null,
            composite: compositeClone
        });
    }

    updateFocus(payload, confidence, timestamp) {
        const { x = 0.5, y = 0.5, depth = 0.3 } = payload || {};
        this.state.focusVector = {
            x: this.lerp(this.state.focusVector.x, x, confidence),
            y: this.lerp(this.state.focusVector.y, y, confidence),
            depth: this.lerp(this.state.focusVector.depth, depth, confidence)
        };
        this.state.updatedAt = timestamp;
        this.emit('focus', this.state.focusVector);
        this.scheduleDecay('focus');
    }

    updateIntention(payload, confidence, timestamp) {
        const { x = 0, y = 0, z = 0, w = 0, engagement = 0.4 } = payload || {};
        this.state.intentionVector = {
            x: this.lerp(this.state.intentionVector.x, x, confidence),
            y: this.lerp(this.state.intentionVector.y, y, confidence),
            z: this.lerp(this.state.intentionVector.z, z, confidence),
            w: this.lerp(this.state.intentionVector.w, w, confidence)
        };
        this.state.engagementLevel = this.lerp(this.state.engagementLevel, engagement, confidence);
        this.state.updatedAt = timestamp;
        this.emit('intention', this.state.intentionVector);
        this.emit('engagement', this.state.engagementLevel);
        this.scheduleDecay('intention');
        this.scheduleDecay('engagement');
    }

    updateBiometrics(payload, confidence, timestamp) {
        const { stress = 0.2, heartRate = 68, temperature = 36.4 } = payload || {};
        this.state.biometricStress = this.lerp(this.state.biometricStress, stress, confidence);
        this.state.updatedAt = timestamp;
        this.emit('biometrics', { stress: this.state.biometricStress, heartRate, temperature });
        this.scheduleDecay('biometrics');
    }

    updateEnvironment(payload, confidence, timestamp) {
        const { luminance = 0.5, noiseLevel = 0.2, motion = 0.1 } = payload || {};
        this.state.environment = {
            luminance: this.lerp(this.state.environment.luminance, luminance, confidence),
            noiseLevel: this.lerp(this.state.environment.noiseLevel, noiseLevel, confidence),
            motion: this.lerp(this.state.environment.motion, motion, confidence)
        };
        this.state.updatedAt = timestamp;
        this.emit('environment', this.state.environment);
        this.scheduleDecay('environment');
    }

    updateGestures(payload, confidence, timestamp) {
        const { intent = null, vector = { x: 0, y: 0, z: 0 } } = payload || {};
        this.state.gestureIntent = intent;
        this.state.updatedAt = timestamp;
        this.emit('gesture', { intent, vector, confidence });
        this.scheduleDecay('gesture');
    }

    scheduleDecay(channel) {
        if (this.decayTimers.has(channel)) {
            clearTimeout(this.decayTimers.get(channel));
        }
        const timeout = setTimeout(() => {
            this.emit(`${channel}:decay`, { channel, timestamp: this.getNow() });
        }, this.decayHalfLife);
        this.decayTimers.set(channel, timeout);
    }

    emit(channel, payload) {
        const listeners = this.subscribers.get(channel);
        if (!listeners) return;
        for (const callback of listeners) {
            try {
                callback(payload);
            } catch (error) {
                console.error(`[SensoryInputBridge] subscriber error on ${channel}`, error);
            }
        }
    }

    lerp(start, end, alpha) {
        return start + (end - start) * alpha;
    }

    getSnapshot() {
        return { ...this.state };
    }

    registerSchema(type, schema) {
        this.schemaRegistry.register(type, schema);
    }

    getSchemaRegistry() {
        return this.schemaRegistry;
    }

    setValidationReporter(reporter) {
        this.validationReporter = typeof reporter === 'function' ? reporter : null;
    }

    getValidationLog() {
        return [...this.validationLog];
    }

    getAdapterState(type) {
        return this.adapterStates.get(type);
    }

    trimHistory(history) {
        if (!Array.isArray(history)) return;
        if (this.channelHistoryLimit <= 0) return;
        while (history.length > this.channelHistoryLimit) {
            history.shift();
        }
    }

    trimWearableHistory(history) {
        if (!Array.isArray(history)) return;
        if (this.wearableHistoryLimit <= 0) return;
        while (history.length > this.wearableHistoryLimit) {
            history.shift();
        }
    }

    cloneSnapshot(snapshot) {
        if (!snapshot) return null;
        const composite = snapshot.composite ? deepClone(snapshot.composite) : {};
        const metadata = composite && typeof composite === 'object' && composite.metadata
            ? deepClone(composite.metadata)
            : undefined;
        const channels = composite && typeof composite === 'object' && composite.channels
            ? deepClone(composite.channels)
            : undefined;
        return {
            type: snapshot.type,
            deviceId: snapshot.deviceId,
            confidence: snapshot.confidence,
            timestamp: snapshot.timestamp,
            firmwareVersion: snapshot.firmwareVersion ?? null,
            composite,
            metadata,
            channels
        };
    }

    recordWearableSnapshot(type, snapshot) {
        if (!snapshot || !snapshot.deviceId) {
            return;
        }
        if (!this.wearableSnapshots.has(type)) {
            this.wearableSnapshots.set(type, new Map());
        }
        const perDevice = this.wearableSnapshots.get(type);
        const clonedSnapshot = this.cloneSnapshot(snapshot);
        perDevice.set(snapshot.deviceId, clonedSnapshot);

        if (!this.wearableHistory.has(type)) {
            this.wearableHistory.set(type, []);
        }
        const history = this.wearableHistory.get(type);
        history.push(this.cloneSnapshot(snapshot));
        this.trimWearableHistory(history);

        const eventPayload = this.cloneSnapshot(snapshot);
        this.emit(`${type}:update`, eventPayload);
        this.emit('wearable:update', { ...eventPayload, type });
    }

    getChannelHistory(type) {
        const entries = this.channels.get(type) || [];
        return entries.map(entry => ({
            ...entry,
            payload: deepClone(entry.payload),
            issues: Array.isArray(entry.issues) ? [...entry.issues] : []
        }));
    }

    setChannelHistoryLimit(limit) {
        const numeric = Number(limit);
        if (!Number.isFinite(numeric) || numeric < 0) {
            this.channelHistoryLimit = 0;
        } else {
            this.channelHistoryLimit = Math.floor(numeric);
        }
        for (const history of this.channels.values()) {
            this.trimHistory(history);
        }
    }

    getWearableSnapshot(type, deviceId) {
        const perDevice = this.wearableSnapshots.get(type);
        if (!perDevice) {
            return null;
        }
        const snapshot = perDevice.get(deviceId);
        return snapshot ? this.cloneSnapshot(snapshot) : null;
    }

    listWearableDevices(type) {
        const perDevice = this.wearableSnapshots.get(type);
        if (!perDevice) return [];
        return Array.from(perDevice.keys());
    }

    getWearableHistory(type) {
        const history = this.wearableHistory.get(type) || [];
        return history.map(entry => this.cloneSnapshot(entry));
    }
}

