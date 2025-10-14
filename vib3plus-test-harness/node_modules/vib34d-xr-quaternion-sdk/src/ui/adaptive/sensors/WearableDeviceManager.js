import { SensoryInputBridge } from '../SensoryInputBridge.js';

const deviceKey = (type, deviceId) => `${type}:${deviceId ?? 'wearable-device'}`;

export class WearableDeviceManager {
    constructor(options = {}) {
        const {
            bridge,
            autoStart = false,
            historyLimit,
            wearableHistoryLimit,
            bridgeOptions = {}
        } = options;

        if (bridge instanceof SensoryInputBridge) {
            this.bridge = bridge;
        } else {
            this.bridge = new SensoryInputBridge({
                ...bridgeOptions,
                channelHistoryLimit: historyLimit ?? bridgeOptions.channelHistoryLimit,
                wearableHistoryLimit: wearableHistoryLimit ?? bridgeOptions.wearableHistoryLimit
            });
        }

        this.autoStart = autoStart;
        this.deviceSubscriptions = new Map();
        this.typeSubscriptions = new Map();

        if (this.autoStart) {
            this.start();
        }
    }

    getBridge() {
        return this.bridge;
    }

    registerAdapter(type, adapter) {
        this.bridge.registerAdapter(type, adapter);
        this.ensureTypeSubscription(type);
        if (this.autoStart && !this.bridge.loopHandle) {
            this.start();
        }
        return adapter;
    }

    unregisterAdapter(type) {
        if (this.typeSubscriptions.has(type)) {
            const unsubscribe = this.typeSubscriptions.get(type);
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            this.typeSubscriptions.delete(type);
        }
        for (const key of Array.from(this.deviceSubscriptions.keys())) {
            if (key.startsWith(`${type}:`)) {
                this.deviceSubscriptions.delete(key);
            }
        }
        this.bridge.adapters.delete(type);
        this.bridge.channels.delete(type);
        this.bridge.adapterStates.delete(type);
    }

    start() {
        this.bridge.start();
    }

    stop() {
        this.bridge.stop();
    }

    ensureTypeSubscription(type) {
        if (this.typeSubscriptions.has(type)) {
            return;
        }
        const unsubscribe = this.bridge.subscribe(`${type}:update`, snapshot => {
            if (!snapshot) return;
            const key = deviceKey(type, snapshot.deviceId);
            const listeners = this.deviceSubscriptions.get(key);
            if (!listeners || listeners.size === 0) {
                return;
            }
            for (const listener of listeners) {
                try {
                    listener({ ...snapshot, type });
                } catch (error) {
                    console.error('[WearableDeviceManager] device listener failed', error);
                }
            }
        });
        this.typeSubscriptions.set(type, unsubscribe);
    }

    subscribeToDevice(type, deviceId, callback) {
        if (typeof callback !== 'function') {
            throw new Error('WearableDeviceManager.subscribeToDevice requires a callback function');
        }
        const key = deviceKey(type, deviceId);
        if (!this.deviceSubscriptions.has(key)) {
            this.deviceSubscriptions.set(key, new Set());
        }
        const listeners = this.deviceSubscriptions.get(key);
        listeners.add(callback);
        this.ensureTypeSubscription(type);

        const snapshot = this.bridge.getWearableSnapshot(type, deviceId);
        if (snapshot) {
            try {
                callback({ ...snapshot, type });
            } catch (error) {
                console.error('[WearableDeviceManager] initial snapshot callback failed', error);
            }
        }

        return () => this.unsubscribeFromDevice(type, deviceId, callback);
    }

    unsubscribeFromDevice(type, deviceId, callback) {
        const key = deviceKey(type, deviceId);
        const listeners = this.deviceSubscriptions.get(key);
        if (!listeners) return;
        listeners.delete(callback);
        if (listeners.size === 0) {
            this.deviceSubscriptions.delete(key);
        }
        this.cleanupTypeSubscription(type);
    }

    cleanupTypeSubscription(type) {
        const hasListeners = Array.from(this.deviceSubscriptions.keys()).some(key => key.startsWith(`${type}:`));
        if (!hasListeners) {
            const unsubscribe = this.typeSubscriptions.get(type);
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            this.typeSubscriptions.delete(type);
        }
    }

    getDeviceSnapshot(type, deviceId) {
        const snapshot = this.bridge.getWearableSnapshot(type, deviceId);
        return snapshot ? { ...snapshot, type } : null;
    }

    listDevices(type) {
        return this.bridge.listWearableDevices(type);
    }

    getDeviceHistory(type) {
        return this.bridge.getWearableHistory(type);
    }

    ingest(type, payload, confidence) {
        this.bridge.ingest(type, payload, confidence);
    }
}

export default WearableDeviceManager;
