const DEFAULT_HEADERS = {
    'content-type': 'application/json'
};

function toIsoString(clock, fallback = new Date()) {
    try {
        const value = typeof clock === 'function' ? clock() : clock;
        if (!value) {
            return new Date(fallback).toISOString();
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        const time = typeof value === 'number' ? value : new Date(value).getTime();
        if (Number.isNaN(time)) {
            return new Date(fallback).toISOString();
        }
        return new Date(time).toISOString();
    } catch (error) {
        return new Date(fallback).toISOString();
    }
}

function ensureFetch(fetchImpl) {
    if (typeof fetchImpl === 'function') {
        return fetchImpl;
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
        return globalThis.fetch.bind(globalThis);
    }
    throw new Error('RemoteLicenseAttestor requires a fetch implementation');
}

function isFunction(value) {
    return typeof value === 'function';
}

function safeJsonParse(text) {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        return { raw: text };
    }
}

function normalizeHeaders(headers = {}) {
    const result = { ...DEFAULT_HEADERS };
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'undefined') continue;
        result[key.toLowerCase()] = value;
    }
    return result;
}

export class RemoteLicenseAttestor {
    constructor(options = {}) {
        this.attestationUrl = options.attestationUrl || null;
        this.revocationUrl = options.revocationUrl || null;
        this.entitlementsUrl = options.entitlementsUrl || null;
        this.fetch = ensureFetch(options.fetch);
        this.logger = options.logger || console;
        this.clock = isFunction(options.clock) ? options.clock : () => new Date();
        this.pollIntervalMs = typeof options.pollIntervalMs === 'number' ? options.pollIntervalMs : 60 * 60 * 1000;
        this.minimumPollIntervalMs = typeof options.minimumPollIntervalMs === 'number' ? options.minimumPollIntervalMs : 5 * 60 * 1000;
        this.failOpen = options.failOpen ?? false;
        this.requestHeaders = normalizeHeaders(options.headers);
        this.transformRequest = isFunction(options.transformRequest) ? options.transformRequest : null;
        this.transformResponse = isFunction(options.transformResponse) ? options.transformResponse : null;
        this.historyLimit = typeof options.historyLimit === 'number' ? options.historyLimit : 50;

        this.listeners = new Map();
        this.history = [];
        this.lastResult = null;
        this.attestationTimer = null;
        this.boundLicenseManager = null;
        this.unregisterValidator = null;
        this.unsubscribeStatus = null;
    }

    on(event, listener) {
        if (!isFunction(listener)) {
            throw new TypeError('RemoteLicenseAttestor.on requires a function listener');
        }
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const listeners = this.listeners.get(event);
        listeners.add(listener);
        return () => this.off(event, listener);
    }

    off(event, listener) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;
        listeners.delete(listener);
        if (listeners.size === 0) {
            this.listeners.delete(event);
        }
    }

    emit(event, payload) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;
        for (const listener of listeners) {
            try {
                listener(payload);
            } catch (error) {
                this.logger?.warn?.('RemoteLicenseAttestor listener error', error);
            }
        }
    }

    recordHistory(entry) {
        this.history.push({
            timestamp: toIsoString(this.clock),
            entry
        });
        if (this.history.length > this.historyLimit) {
            this.history.shift();
        }
    }

    getHistory() {
        return this.history.map(item => ({
            timestamp: item.timestamp,
            entry: item.entry
        }));
    }

    getLastResult() {
        return this.lastResult ? { ...this.lastResult } : null;
    }

    createRequestPayload(type, license, context) {
        const basePayload = {
            license: {
                key: license.key,
                tenantId: license.tenantId || null,
                signature: license.signature || null,
                features: Array.isArray(license.features) ? license.features : [],
                expiresAt: license.expiresAt || null,
                issuedAt: license.issuedAt || null,
                metadata: license.metadata || null
            },
            context: context || {},
            timestamp: toIsoString(this.clock)
        };

        if (this.transformRequest) {
            return this.transformRequest({ type, payload: basePayload }) || basePayload;
        }
        return basePayload;
    }

    async performFetch(url, payload, type) {
        const requestInit = {
            method: 'POST',
            headers: { ...this.requestHeaders },
            body: JSON.stringify(payload)
        };

        let request = requestInit;
        if (this.transformRequest) {
            const transformed = this.transformRequest({ type, payload, request: requestInit }) || requestInit;
            request = { ...requestInit, ...transformed };
            if (transformed?.headers) {
                request.headers = normalizeHeaders(transformed.headers);
            }
        }

        const response = await this.fetch(url, request);
        const text = typeof response.text === 'function' ? await response.text() : '';
        const data = this.transformResponse ? this.transformResponse({ type, response, text }) : safeJsonParse(text);

        if (!response.ok) {
            const error = new Error(`Remote attestation request failed with status ${response.status}`);
            error.status = response.status;
            error.response = data;
            throw error;
        }

        return data || {};
    }

    async attest(license, context = {}) {
        if (!this.attestationUrl) {
            return { skipped: true };
        }

        const payload = this.createRequestPayload('attestation', license, context);
        const data = await this.performFetch(this.attestationUrl, payload, 'attestation');
        const attestedAt = data.attestedAt || data.timestamp || toIsoString(this.clock);

        return {
            valid: data.valid !== false,
            reason: data.reason || (data.valid === false ? 'REMOTE_INVALID' : 'REMOTE_VALID'),
            attestedAt,
            nextCheckAt: data.nextCheckAt || null,
            nextCheckInMs: typeof data.nextCheckInMs === 'number' ? data.nextCheckInMs : null,
            metadata: data.metadata || null,
            raw: data
        };
    }

    async checkRevocation(license, context = {}) {
        if (!this.revocationUrl) {
            return { skipped: true };
        }
        const payload = this.createRequestPayload('revocation', license, context);
        const data = await this.performFetch(this.revocationUrl, payload, 'revocation');
        return {
            revoked: data.revoked === true,
            reason: data.reason || (data.revoked ? 'REMOTE_REVOKED' : 'REMOTE_ACTIVE'),
            checkedAt: data.checkedAt || data.timestamp || toIsoString(this.clock),
            metadata: data.metadata || null,
            raw: data
        };
    }

    async syncEntitlements(license, context = {}) {
        if (!this.entitlementsUrl) {
            return { skipped: true };
        }
        const payload = this.createRequestPayload('entitlements', license, context);
        const data = await this.performFetch(this.entitlementsUrl, payload, 'entitlements');
        const entitlements = Array.isArray(data.entitlements) ? data.entitlements : [];
        return {
            entitlements,
            updatedAt: data.updatedAt || data.timestamp || toIsoString(this.clock),
            ttlMs: typeof data.ttlMs === 'number' ? data.ttlMs : null,
            metadata: data.metadata || null,
            raw: data
        };
    }

    async runAttestation(license, context = {}) {
        const result = {};
        try {
            const attestation = await this.attest(license, context);
            result.attestation = attestation;
            this.emit('attestation', { license, context, attestation });
            if (attestation.valid === false) {
                this.recordHistory(result);
                this.lastResult = result;
                return result;
            }
        } catch (error) {
            this.emit('error', { type: 'attestation', license, context, error });
            throw error;
        }

        try {
            const revocation = await this.checkRevocation(license, context);
            result.revocation = revocation;
            this.emit('revocation', { license, context, revocation });
            if (revocation.revoked) {
                this.recordHistory(result);
                this.lastResult = result;
                return result;
            }
        } catch (error) {
            this.emit('error', { type: 'revocation', license, context, error });
            throw error;
        }

        try {
            const entitlements = await this.syncEntitlements(license, context);
            result.entitlements = entitlements;
            this.emit('entitlements', { license, context, entitlements });
        } catch (error) {
            this.emit('error', { type: 'entitlements', license, context, error });
            if (!this.failOpen) {
                throw error;
            }
        }

        this.recordHistory(result);
        this.lastResult = result;
        return result;
    }

    createValidator() {
        return async (license, context = {}) => {
            try {
                const result = await this.runAttestation(license, context);
                this.emit('validation', { license, context, result });

                if (result.attestation && result.attestation.valid === false) {
                    return {
                        valid: false,
                        reason: result.attestation.reason || 'REMOTE_INVALID',
                        metadata: { remote: result }
                    };
                }

                if (result.revocation && result.revocation.revoked) {
                    return {
                        valid: false,
                        reason: result.revocation.reason || 'REMOTE_REVOKED',
                        metadata: { remote: result }
                    };
                }

                const metadata = { remote: result };
                if (Array.isArray(result.entitlements?.entitlements) && result.entitlements.entitlements.length > 0) {
                    metadata.entitlements = result.entitlements.entitlements;
                }

                return { valid: true, metadata };
            } catch (error) {
                this.emit('error', { type: 'validation', license, context, error });
                if (this.failOpen) {
                    return {
                        valid: true,
                        metadata: {
                            remote: {
                                error: error?.message || 'Remote attestation failed',
                                failOpen: true
                            }
                        }
                    };
                }
                return {
                    valid: false,
                    reason: 'REMOTE_ATTESTATION_ERROR',
                    metadata: {
                        remote: {
                            error: error?.message || 'Remote attestation failed'
                        }
                    }
                };
            }
        };
    }

    detach() {
        if (this.attestationTimer) {
            clearTimeout(this.attestationTimer);
            this.attestationTimer = null;
        }
        if (this.unregisterValidator) {
            this.unregisterValidator();
            this.unregisterValidator = null;
        }
        if (this.unsubscribeStatus) {
            this.unsubscribeStatus();
            this.unsubscribeStatus = null;
        }
        this.boundLicenseManager = null;
    }

    scheduleNext(delayMs, context = {}) {
        if (this.attestationTimer) {
            clearTimeout(this.attestationTimer);
            this.attestationTimer = null;
        }

        if (!delayMs || delayMs <= 0) {
            delayMs = this.pollIntervalMs;
        }

        const safeDelay = Math.max(delayMs, this.minimumPollIntervalMs);
        this.attestationTimer = setTimeout(() => {
            this.attestationTimer = null;
            if (!this.boundLicenseManager) return;
            this.boundLicenseManager.validate({ ...context, trigger: 'remote-attestor' }).catch(error => {
                this.emit('error', { type: 'scheduled-validation', error, context });
            });
        }, safeDelay);

        this.emit('schedule', { delayMs: safeDelay, context });
    }

    bindToLicenseManager(manager, options = {}) {
        this.detach();

        if (!manager) {
            return () => {};
        }

        this.boundLicenseManager = manager;
        this.unregisterValidator = manager.registerValidator(this.createValidator());

        if (typeof manager.onStatusChange === 'function') {
            this.unsubscribeStatus = manager.onStatusChange(status => {
                if (!status || status.state !== 'valid') {
                    if (status?.state === 'unregistered') {
                        this.detach();
                    }
                    return;
                }

                const remoteMeta = status.metadata?.remote || status.metadata?.remoteAttestation;
                let delayMs = null;
                if (remoteMeta?.attestation?.nextCheckInMs) {
                    delayMs = remoteMeta.attestation.nextCheckInMs;
                } else if (remoteMeta?.attestation?.nextCheckAt) {
                    delayMs = new Date(remoteMeta.attestation.nextCheckAt).getTime() - Date.now();
                } else if (remoteMeta?.entitlements?.ttlMs) {
                    delayMs = remoteMeta.entitlements.ttlMs;
                }

                this.scheduleNext(delayMs, { trigger: 'status-change' });
            });
        }

        const license = manager.getLicense();
        if (license?.key) {
            if (options.immediate !== false) {
                manager.validate({ ...options.initialContext, trigger: 'remote-attestor-initial' }).catch(error => {
                    this.emit('error', { type: 'initial-validation', error, context: options.initialContext });
                });
            } else {
                this.scheduleNext(options.initialDelayMs || this.pollIntervalMs, { trigger: 'initial-schedule' });
            }
        }

        return () => this.detach();
    }
}
