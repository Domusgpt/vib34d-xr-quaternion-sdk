import { createSignedS3StorageAdapter, createLogBrokerStorageAdapter } from '../../telemetry/storage/RemoteStorageAdapters.js';

function clone(value) {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}

function createSnapshotTransformer({ includeSummary = true, redactContextKeys = [] } = {}) {
    const redactions = new Set(redactContextKeys);
    return snapshot => {
        if (!snapshot || typeof snapshot !== 'object') {
            return null;
        }

        const capturedAt = snapshot.capturedAt ? new Date(snapshot.capturedAt).toISOString() : new Date().toISOString();
        const id = typeof snapshot.id === 'string' && snapshot.id.trim().length > 0
            ? snapshot.id
            : snapshot.capturedAt || capturedAt;

        const normalized = {
            id,
            capturedAt,
            context: {},
            kpis: {}
        };

        if (snapshot.context && typeof snapshot.context === 'object') {
            const context = {};
            for (const [key, value] of Object.entries(snapshot.context)) {
                if (!redactions.has(key)) {
                    context[key] = clone(value);
                }
            }
            normalized.context = context;
        }

        if (snapshot.kpis && typeof snapshot.kpis === 'object') {
            normalized.kpis = clone(snapshot.kpis);
        }

        if (includeSummary && snapshot.summary && typeof snapshot.summary === 'object') {
            normalized.summary = clone(snapshot.summary);
        }

        return normalized;
    };
}

function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function ensureSnapshotsArray(value, transform) {
    const snapshots = toArray(value);
    const normalized = [];
    for (const snapshot of snapshots) {
        const transformed = transform(snapshot);
        if (transformed) {
            normalized.push(transformed);
        }
    }
    return normalized;
}

function defaultSerializePayload(snapshots = [], { retentionPolicy } = {}) {
    return {
        exportedAt: new Date().toISOString(),
        snapshotCount: Array.isArray(snapshots) ? snapshots.length : 0,
        ...(retentionPolicy ? { retentionPolicy } : {}),
        snapshots
    };
}

export function createCommercializationSnapshotRemoteStorage(options = {}) {
    const {
        adapter,
        includeSummary = true,
        redactContextKeys = [],
        transformSnapshot,
        transformIncoming,
        onError
    } = options;

    if (!adapter || typeof adapter.write !== 'function') {
        throw new Error('[createCommercializationSnapshotRemoteStorage] `adapter` with a write method is required.');
    }

    const outgoingTransform = typeof transformSnapshot === 'function'
        ? snapshot => transformSnapshot(snapshot, { includeSummary, redactContextKeys: [...redactContextKeys] })
        : createSnapshotTransformer({ includeSummary, redactContextKeys });

    const incomingTransform = typeof transformIncoming === 'function'
        ? records => transformIncoming(records, { includeSummary, redactContextKeys: [...redactContextKeys] })
        : records => ensureSnapshotsArray(records, outgoingTransform);

    async function safelyInvoke(method, ...args) {
        if (typeof method !== 'function') {
            return undefined;
        }
        try {
            return await method(...args);
        } catch (error) {
            onError?.(error);
            console?.warn?.('[createCommercializationSnapshotRemoteStorage] operation failed', error);
            return undefined;
        }
    }

    return {
        async loadSnapshots() {
            const records = await safelyInvoke(adapter.read?.bind(adapter));
            return incomingTransform(records || []);
        },
        async saveSnapshots(snapshots) {
            const payload = ensureSnapshotsArray(snapshots, outgoingTransform);
            if (payload.length === 0) {
                return;
            }
            await safelyInvoke(adapter.write.bind(adapter), payload);
        },
        async appendSnapshot(snapshot) {
            const payload = ensureSnapshotsArray([snapshot], outgoingTransform);
            if (payload.length === 0) {
                return;
            }
            await safelyInvoke(adapter.write.bind(adapter), payload);
        },
        async clearSnapshots() {
            await safelyInvoke(adapter.clear?.bind(adapter));
        }
    };
}

export function createSignedS3CommercializationSnapshotStorage(options = {}) {
    const {
        includeSummary,
        redactContextKeys,
        transformSnapshot,
        transformIncoming,
        onError,
        serialize = defaultSerializePayload,
        ...adapterOptions
    } = options;

    const adapter = createSignedS3StorageAdapter({
        ...adapterOptions,
        serialize
    });

    return createCommercializationSnapshotRemoteStorage({
        adapter,
        includeSummary,
        redactContextKeys,
        transformSnapshot,
        transformIncoming,
        onError
    });
}

export function createLogBrokerCommercializationSnapshotStorage(options = {}) {
    const {
        includeSummary,
        redactContextKeys,
        transformSnapshot,
        transformIncoming,
        onError,
        serialize = defaultSerializePayload,
        ...adapterOptions
    } = options;

    const adapter = createLogBrokerStorageAdapter({
        ...adapterOptions,
        serialize
    });

    return createCommercializationSnapshotRemoteStorage({
        adapter,
        includeSummary,
        redactContextKeys,
        transformSnapshot,
        transformIncoming,
        onError
    });
}

export { defaultSerializePayload as createCommercializationSnapshotPayload };
