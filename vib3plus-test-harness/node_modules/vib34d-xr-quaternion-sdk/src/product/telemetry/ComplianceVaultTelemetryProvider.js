import { TelemetryProvider } from './TelemetryProvider.js';

function createDefaultStorageAdapter(storageKey) {
    if (typeof window !== 'undefined' && window?.localStorage) {
        return {
            read() {
                try {
                    const raw = window.localStorage.getItem(storageKey);
                    return raw ? JSON.parse(raw) : [];
                } catch (error) {
                    console.warn('[ComplianceVaultTelemetryProvider] Failed to read localStorage', error);
                    return [];
                }
            },
            write(records) {
                try {
                    window.localStorage.setItem(storageKey, JSON.stringify(records));
                } catch (error) {
                    console.warn('[ComplianceVaultTelemetryProvider] Failed to write localStorage', error);
                }
            },
            clear() {
                try {
                    window.localStorage.removeItem(storageKey);
                } catch (error) {
                    console.warn('[ComplianceVaultTelemetryProvider] Failed to clear localStorage', error);
                }
            }
        };
    }

    let memoryRecords = [];
    return {
        read() {
            return [...memoryRecords];
        },
        write(records) {
            memoryRecords = [...records];
        },
        clear() {
            memoryRecords = [];
        }
    };
}

function sanitizeRecord(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const base = {
        event: entry.event,
        classification: entry.classification,
        timestamp: entry.timestamp || new Date().toISOString(),
        payload: entry.payload ?? null
    };

    if ('licenseKey' in entry) {
        base.licenseKey = entry.licenseKey;
    }
    if (entry.source) {
        base.source = entry.source;
    }

    return base;
}

export class ComplianceVaultTelemetryProvider extends TelemetryProvider {
    constructor(options = {}) {
        super({ id: options.id || 'compliance-vault', metadata: options.metadata });

        this.storageKey = options.storageKey || 'vib34d:compliance-vault';
        this.maxRecords = options.maxRecords || 500;
        this.includeClassifications = new Set(options.includeClassifications || ['compliance']);
        this.storageAdapter = options.storageAdapter || createDefaultStorageAdapter(this.storageKey);

        const existing = this.storageAdapter.read?.();
        this.records = Array.isArray(existing) ? [...existing] : [];
        this.initializationPromise = Promise.resolve(existing)
            .then((records) => {
                if (Array.isArray(records)) {
                    this.records = [...records];
                }
                return this.records;
            })
            .catch((error) => {
                console.warn('[ComplianceVaultTelemetryProvider] Failed to initialize from storage', error);
                return this.records;
            });
    }

    shouldCapture(classification) {
        return this.includeClassifications.has(classification);
    }

    store(entry) {
        const normalized = sanitizeRecord(entry);
        if (!normalized) return;

        this.records.push(normalized);
        if (this.records.length > this.maxRecords) {
            this.records.splice(0, this.records.length - this.maxRecords);
        }

        const result = this.storageAdapter.write?.(this.records);
        if (result && typeof result.then === 'function') {
            result.catch((error) => {
                console.warn('[ComplianceVaultTelemetryProvider] Failed to persist compliance record', error);
            });
        }
    }

    track(event, record = {}, context = {}) {
        const classification = context.classification || record.classification;
        if (!this.shouldCapture(classification)) {
            return;
        }

        this.store({
            event,
            classification: classification || 'compliance',
            timestamp: record.timestamp,
            payload: record.payload,
            licenseKey: record.licenseKey
        });
    }

    recordAudit(entry) {
        if (!this.shouldCapture(entry?.classification)) {
            return;
        }
        this.store({ ...entry, source: 'audit-log' });
    }

    getRecords() {
        return [...this.records];
    }

    clear() {
        this.records = [];
        const result = this.storageAdapter.clear?.();
        if (result && typeof result.then === 'function') {
            result.catch((error) => {
                console.warn('[ComplianceVaultTelemetryProvider] Failed to clear compliance vault', error);
            });
        }
    }

    flush() {
        const result = this.storageAdapter.write?.(this.records);
        if (result && typeof result.then === 'function') {
            result.catch((error) => {
                console.warn('[ComplianceVaultTelemetryProvider] Failed to flush compliance vault', error);
            });
        }
    }

    async whenReady() {
        await this.initializationPromise;
        return this.getRecords();
    }
}
