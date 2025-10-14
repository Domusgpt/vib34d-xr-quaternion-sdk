const DEFAULT_STATUS = {
    state: 'unregistered',
    reason: 'NO_LICENSE',
    validatedAt: null
};

function clone(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
}

export class LicenseManager {
    constructor(options = {}) {
        this.clock = typeof options.clock === 'function' ? options.clock : () => new Date();
        this.logger = options.logger || console;
        this.validators = [];
        this.listeners = new Set();
        this.status = { ...DEFAULT_STATUS };
        this.currentLicense = null;
        this.validationHistory = [];

        if (Array.isArray(options.validators)) {
            for (const validator of options.validators) {
                this.registerValidator(validator);
            }
        }
    }

    onStatusChange(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('LicenseManager.onStatusChange requires a function listener');
        }
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(status) {
        for (const listener of this.listeners) {
            try {
                listener(clone(status));
            } catch (error) {
                this.logger?.warn?.('LicenseManager listener failed', error);
            }
        }
    }

    getLicense() {
        return clone(this.currentLicense);
    }

    setLicense(license = null) {
        if (license === null) {
            this.clearLicense();
            return { ...this.status };
        }

        if (typeof license !== 'object' || !license.key) {
            throw new TypeError('LicenseManager.setLicense requires a license object with a key');
        }

        this.currentLicense = {
            key: license.key,
            tenantId: license.tenantId || null,
            features: Array.isArray(license.features) ? [...new Set(license.features)] : [],
            expiresAt: license.expiresAt || null,
            issuedAt: license.issuedAt || null,
            signature: license.signature || null,
            metadata: license.metadata ? { ...license.metadata } : {}
        };

        this.status = {
            state: 'pending',
            reason: 'PENDING_VALIDATION',
            validatedAt: null
        };

        this.notify(this.status);
        return { ...this.status };
    }

    clearLicense() {
        this.currentLicense = null;
        this.status = { ...DEFAULT_STATUS };
        this.notify(this.status);
        return { ...this.status };
    }

    registerValidator(validator) {
        if (typeof validator !== 'function') {
            throw new TypeError('LicenseManager validator must be a function');
        }
        this.validators.push(validator);
        return () => {
            const index = this.validators.indexOf(validator);
            if (index >= 0) {
                this.validators.splice(index, 1);
            }
        };
    }

    async validate(context = {}) {
        if (!this.currentLicense) {
            this.status = { ...DEFAULT_STATUS };
            this.recordHistory(this.status);
            this.notify(this.status);
            return { ...this.status };
        }

        const now = this.clock();
        const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();

        if (!this.currentLicense.key) {
            this.status = {
                state: 'invalid',
                reason: 'MISSING_KEY',
                validatedAt: this.toIsoString(nowTime)
            };
            this.recordHistory(this.status);
            this.notify(this.status);
            return { ...this.status };
        }

        if (this.currentLicense.expiresAt) {
            const expiresTime = new Date(this.currentLicense.expiresAt).getTime();
            if (Number.isNaN(expiresTime)) {
                this.status = {
                    state: 'invalid',
                    reason: 'INVALID_EXPIRY',
                    validatedAt: this.toIsoString(nowTime)
                };
                this.recordHistory(this.status);
                this.notify(this.status);
                return { ...this.status };
            }
            if (nowTime >= expiresTime) {
                this.status = {
                    state: 'expired',
                    reason: 'LICENSE_EXPIRED',
                    validatedAt: this.toIsoString(nowTime)
                };
                this.recordHistory(this.status);
                this.notify(this.status);
                return { ...this.status };
            }
        }

        let mergedMetadata = {};
        for (const validator of this.validators) {
            try {
                const result = await validator({ ...this.currentLicense }, { ...context });
                if (result === false) {
                    this.status = {
                        state: 'invalid',
                        reason: 'VALIDATOR_REJECTED',
                        validatedAt: this.toIsoString(nowTime)
                    };
                    this.recordHistory(this.status);
                    this.notify(this.status);
                    return { ...this.status };
                }
                if (result && typeof result === 'object') {
                    if (result.valid === false) {
                        this.status = {
                            state: 'invalid',
                            reason: result.reason || 'VALIDATOR_REJECTED',
                            validatedAt: this.toIsoString(nowTime)
                        };
                        this.recordHistory(this.status);
                        this.notify(this.status);
                        return { ...this.status };
                    }
                    if (result.metadata && typeof result.metadata === 'object') {
                        mergedMetadata = { ...mergedMetadata, ...result.metadata };
                    }
                }
            } catch (error) {
                this.logger?.warn?.('License validator threw error', error);
                this.status = {
                    state: 'invalid',
                    reason: 'VALIDATOR_ERROR',
                    error: error?.message || 'Unknown validator error',
                    validatedAt: this.toIsoString(nowTime)
                };
                this.recordHistory(this.status);
                this.notify(this.status);
                return { ...this.status };
            }
        }

        this.status = {
            state: 'valid',
            reason: 'VALID',
            metadata: undefined,
            validatedAt: this.toIsoString(nowTime)
        };

        if (Object.keys(mergedMetadata).length) {
            if (this.currentLicense) {
                if (Array.isArray(mergedMetadata.entitlements)) {
                    const featureSet = new Set(this.currentLicense.features || []);
                    for (const feature of mergedMetadata.entitlements) {
                        if (typeof feature === 'string' && feature) {
                            featureSet.add(feature);
                        }
                    }
                    this.currentLicense.features = [...featureSet];
                }

                if (mergedMetadata.remote && mergedMetadata.remote.entitlements?.entitlements) {
                    const featureSet = new Set(this.currentLicense.features || []);
                    for (const feature of mergedMetadata.remote.entitlements.entitlements) {
                        if (typeof feature === 'string' && feature) {
                            featureSet.add(feature);
                        }
                    }
                    this.currentLicense.features = [...featureSet];
                }

                const existingMetadata = this.currentLicense.metadata && typeof this.currentLicense.metadata === 'object'
                    ? { ...this.currentLicense.metadata }
                    : {};

                this.currentLicense.metadata = { ...existingMetadata, ...mergedMetadata };
            }

            this.status.metadata = mergedMetadata;
        }
        this.recordHistory(this.status);
        this.notify(this.status);
        return { ...this.status };
    }

    recordHistory(status) {
        this.validationHistory.push({
            status: { ...status },
            timestamp: this.toIsoString(this.clock())
        });
        if (this.validationHistory.length > 50) {
            this.validationHistory.shift();
        }
    }

    toIsoString(value) {
        if (value instanceof Date) {
            return value.toISOString();
        }
        const time = typeof value === 'number' ? value : new Date(value).getTime();
        if (Number.isNaN(time)) {
            return new Date().toISOString();
        }
        return new Date(time).toISOString();
    }

    getStatus() {
        return { ...this.status };
    }

    getValidationHistory() {
        return this.validationHistory.map(entry => ({
            status: { ...entry.status },
            timestamp: entry.timestamp
        }));
    }

    hasFeature(feature) {
        if (!feature) return false;
        return Array.isArray(this.currentLicense?.features) && this.currentLicense.features.includes(feature);
    }

    requireFeature(feature) {
        if (!this.hasFeature(feature)) {
            const error = new Error(`License does not grant required feature: ${feature}`);
            error.code = 'LICENSE_FEATURE_MISSING';
            throw error;
        }
    }

    isActive() {
        return this.status.state === 'valid';
    }
}
