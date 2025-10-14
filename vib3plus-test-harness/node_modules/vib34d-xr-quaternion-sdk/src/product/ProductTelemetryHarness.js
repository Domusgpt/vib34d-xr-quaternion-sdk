import { ConsoleTelemetryProvider } from './telemetry/ConsoleTelemetryProvider.js';
import { LicenseAttestationProfileRegistry } from './licensing/LicenseAttestationProfileRegistry.js';
import { resolveLicenseAttestationProfilePack } from './licensing/LicenseAttestationProfileCatalog.js';
import { LicenseCommercializationReporter } from './licensing/LicenseCommercializationReporter.js';
import { LicenseCommercializationSnapshotStore } from './licensing/LicenseCommercializationSnapshotStore.js';

const DEFAULT_CLASSIFICATION_RULES = [
    { prefix: 'adaptive.', classification: 'interaction' },
    { prefix: 'design.layout.', classification: 'analytics' },
    { prefix: 'design.spec.', classification: 'analytics' },
    { prefix: 'design.telemetry.', classification: 'system' },
    { prefix: 'sensors.adapter.', classification: 'system' },
    { prefix: 'sensors.schema', classification: 'compliance' },
    { prefix: 'compliance.', classification: 'compliance' },
    { prefix: 'privacy.', classification: 'compliance' },
    { prefix: 'biometric.', classification: 'biometric' }
];

export class ProductTelemetryHarness {
    constructor(options = {}) {
        this.enabled = options.enabled ?? true;
        this.licenseKey = options.licenseKey || null;
        this.flushInterval = options.flushInterval || 10000;
        this.flushHandle = null;
        this.buffer = [];
        this.licenseManager = options.licenseManager || null;
        this.licenseAttestor = null;
        this.licenseAttestorSubscriptions = [];
        this.licenseAttestorDetach = null;
        this.licenseAttestorBindingOptions = {
            bindToLicenseManager: true,
            attestorOptions: undefined
        };

        this.licenseAttestationProfiles = new LicenseAttestationProfileRegistry({
            defaultProfileId: options.defaultLicenseAttestationProfileId
        });

        if (options.commercializationReporter instanceof LicenseCommercializationReporter) {
            this.commercializationReporter = options.commercializationReporter;
        } else if (options.commercialization?.enabled === false) {
            this.commercializationReporter = null;
        } else {
            const commercializationOptions = options.commercialization || {};
            this.commercializationReporter = new LicenseCommercializationReporter(commercializationOptions);
        }

        this.commercializationSnapshotStore = null;
        this.commercializationSnapshotScheduleHandle = null;
        this.commercializationSnapshotScheduleContext = null;
        this.commercializationUpdateUnsubscribe = null;

        if (this.commercializationReporter) {
            const commercializationOptions = options.commercialization || {};
            const snapshotConfig = commercializationOptions.snapshotStore;
            if (snapshotConfig instanceof LicenseCommercializationSnapshotStore) {
                this.commercializationSnapshotStore = snapshotConfig;
            } else if (snapshotConfig !== false) {
                const snapshotOptions = snapshotConfig && typeof snapshotConfig === 'object'
                    ? snapshotConfig
                    : (commercializationOptions.snapshotStoreOptions || {});
                this.commercializationSnapshotStore = new LicenseCommercializationSnapshotStore(snapshotOptions);
            }

            if (this.commercializationSnapshotStore) {
                this.commercializationUpdateUnsubscribe = this.commercializationReporter.addUpdateListener(summary => {
                    this.commercializationSnapshotStore.recordSnapshot(summary, { trigger: 'reporter-update' });
                });

                if (commercializationOptions.captureInitialSnapshot !== false) {
                    this.captureCommercializationSnapshot({ trigger: 'telemetry-bootstrap' });
                }

                if (Number.isFinite(commercializationOptions.snapshotIntervalMs)) {
                    this.startCommercializationSnapshotSchedule(
                        commercializationOptions.snapshotIntervalMs,
                        { trigger: 'scheduled-capture' }
                    );
                }
            }
        }

        this.dataMinimization = {
            omitLicense: options.dataMinimization?.omitLicense ?? false,
            allowedFields: options.dataMinimization?.allowedFields,
            anonymize: options.dataMinimization?.anonymize ?? false
        };

        this.defaultClassification = options.defaultClassification || 'analytics';
        this.classificationRules = (options.classificationRules || DEFAULT_CLASSIFICATION_RULES)
            .map(rule => this.createClassificationRule(rule))
            .filter(Boolean);

        const defaultConsent = {
            system: true,
            compliance: true,
            interaction: true,
            analytics: false,
            biometric: false,
            ...(options.defaultConsent || {})
        };

        this.consent = new Map(Object.entries(defaultConsent));
        this.auditLog = [];
        this.auditLogLimit = options.auditLogLimit || 200;
        this.onConsentDecision = typeof options.onConsentDecision === 'function' ? options.onConsentDecision : null;

        this.providers = new Map();

        this.requestMiddleware = [];

        if (this.licenseManager) {
            this.attachLicenseFromManager(this.licenseManager.getLicense());
            this.licenseManagerSubscription = this.licenseManager.onStatusChange?.(status => {
                if (status?.state === 'valid') {
                    this.attachLicenseFromManager(this.licenseManager.getLicense());
                } else if (status?.state === 'unregistered') {
                    this.attachLicense(null);
                }
            });
        }

        if (Array.isArray(options.requestMiddleware)) {
            for (const middleware of options.requestMiddleware) {
                if (typeof middleware === 'function') {
                    this.registerRequestMiddleware(middleware);
                }
            }
        }

        if (options.useDefaultProvider !== false) {
            this.registerProvider(new ConsoleTelemetryProvider(options.consoleProvider || {}));
        }

        (options.providers || []).forEach(provider => this.registerProvider(provider));

        this.bootstrapLicenseAttestationPacks(options);

        if (Array.isArray(options.licenseAttestationProfiles)) {
            for (const profile of options.licenseAttestationProfiles) {
                this.registerLicenseAttestationProfile(profile);
            }
            if (options.defaultLicenseAttestationProfileId) {
                this.licenseAttestationProfiles.setDefaultProfile(options.defaultLicenseAttestationProfileId);
            }
        }

        if (options.licenseAttestor) {
            this.setLicenseAttestor(options.licenseAttestor, options.licenseAttestorBinding);
        }
    }

    createClassificationRule(rule) {
        if (!rule) return null;

        if (typeof rule === 'function') {
            return { test: rule, classification: this.defaultClassification };
        }

        if (rule instanceof RegExp) {
            return { test: event => rule.test(event), classification: this.defaultClassification };
        }

        if (typeof rule === 'object') {
            if (typeof rule.test === 'function') {
                return { test: rule.test, classification: rule.classification || this.defaultClassification };
            }

            if (typeof rule.prefix === 'string') {
                return { test: event => event.startsWith(rule.prefix), classification: rule.classification || this.defaultClassification };
            }

            if (rule.match instanceof RegExp) {
                return { test: event => rule.match.test(event), classification: rule.classification || this.defaultClassification };
            }
        }

        throw new Error('Invalid classification rule supplied to ProductTelemetryHarness');
    }

    registerProvider(provider) {
        this.providers.set(provider.id, provider);
        if (this.requestMiddleware.length > 0 && typeof provider.registerRequestMiddleware === 'function') {
            for (const middleware of this.requestMiddleware) {
                provider.registerRequestMiddleware(middleware);
            }
        }
    }

    removeProvider(id) {
        this.providers.delete(id);
    }

    registerRequestMiddleware(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Telemetry request middleware must be a function.');
        }

        this.requestMiddleware.push(middleware);

        for (const provider of this.providers.values()) {
            if (typeof provider.registerRequestMiddleware === 'function') {
                provider.registerRequestMiddleware(middleware);
            }
        }
    }

    clearRequestMiddleware() {
        this.requestMiddleware = [];
        for (const provider of this.providers.values()) {
            if (typeof provider.clearRequestMiddleware === 'function') {
                provider.clearRequestMiddleware();
            }
        }
    }

    registerLicenseAttestationProfile(profileOrId, maybeProfile, context = {}) {
        const profile = this.licenseAttestationProfiles.registerProfile(profileOrId, maybeProfile);
        this.recordAudit('system.license.attestation_profile_registered', {
            profileId: profile.id,
            sla: profile.sla || null
        }, 'system');
        if (this.commercializationReporter) {
            this.commercializationReporter.recordProfileRegistration(profile, {
                ...context,
                packId: context.packId || this.commercializationReporter.getPackIdForProfile(profile.id) || null,
                setAsDefault: context.setAsDefault || false
            });
        }
        return profile;
    }

    registerLicenseAttestationProfilePack(packOrId, options = {}) {
        const pack = resolveLicenseAttestationProfilePack(packOrId, options);
        const registeredProfileIds = [];
        const previousDefaultId = this.licenseAttestationProfiles.getDefaultProfileId();

        for (const profile of pack.profiles) {
            const result = this.registerLicenseAttestationProfile(profile, undefined, {
                packId: pack.id,
                source: 'catalog-pack',
                metadata: pack.metadata,
                setAsDefault: false
            });
            registeredProfileIds.push(result.id);
        }

        let defaultProfileId = this.licenseAttestationProfiles.getDefaultProfileId();
        if (pack.defaultProfileId && options.applyDefault !== false) {
            this.setDefaultLicenseAttestationProfile(pack.defaultProfileId);
            defaultProfileId = pack.defaultProfileId;
        } else if (options.applyDefault === false) {
            if (previousDefaultId) {
                this.licenseAttestationProfiles.setDefaultProfile(previousDefaultId);
                defaultProfileId = previousDefaultId;
            } else if (typeof this.licenseAttestationProfiles.clearDefaultProfile === 'function') {
                this.licenseAttestationProfiles.clearDefaultProfile();
                defaultProfileId = null;
            }
        }

        this.recordAudit('system.license.attestation_profile_pack_registered', {
            packId: pack.id,
            profileIds: registeredProfileIds,
            defaultProfileId,
            metadata: pack.metadata || null
        }, 'system');

        if (this.commercializationReporter) {
            this.commercializationReporter.recordPackRegistration(pack, {
                registeredProfileIds,
                defaultProfileId,
                appliedDefault: defaultProfileId === pack.defaultProfileId,
                options,
                applyDefault: options.applyDefault
            });
            if (defaultProfileId) {
                this.commercializationReporter.recordDefaultProfileChange(defaultProfileId, {
                    packId: pack.id
                });
            } else {
                this.commercializationReporter.recordDefaultProfileChange(null, {
                    packId: pack.id
                });
            }
        }

        return {
            id: pack.id,
            name: pack.name,
            description: pack.description,
            defaultProfileId,
            profileIds: registeredProfileIds,
            metadata: pack.metadata || null
        };
    }

    getLicenseAttestationProfiles() {
        return this.licenseAttestationProfiles.getProfiles();
    }

    getLicenseAttestationProfile(id) {
        return this.licenseAttestationProfiles.getProfile(id);
    }

    setDefaultLicenseAttestationProfile(id) {
        const previousDefault = this.licenseAttestationProfiles.getDefaultProfileId();
        this.licenseAttestationProfiles.setDefaultProfile(id);
        this.recordAudit('system.license.attestation_profile_default', { profileId: id }, 'system');
        if (this.commercializationReporter) {
            this.commercializationReporter.recordDefaultProfileChange(id, {
                previousDefaultId: previousDefault
            });
        }
    }

    setLicenseAttestorFromProfile(profileId, overrides = {}) {
        const result = this.licenseAttestationProfiles.createAttestor(profileId, overrides);
        this.setLicenseAttestor(result.attestor, result.binding);
        this.recordAudit('system.license.attestation_profile_applied', {
            profileId: result.profile.id,
            sla: result.profile.sla || null
        }, 'system');
        if (this.commercializationReporter) {
            this.commercializationReporter.recordProfileApplied(result.profile, {
                packId: this.commercializationReporter.getPackIdForProfile(result.profile.id),
                context: overrides
            });
        }
        return result;
    }

    bootstrapLicenseAttestationPacks(options) {
        const packs = options.licenseAttestationProfilePacks;
        if (Array.isArray(packs)) {
            for (const entry of packs) {
                if (!entry) continue;
                if (typeof entry === 'string') {
                    this.registerLicenseAttestationProfilePack(entry, options.licenseAttestationProfilePackOptions || {});
                } else if (typeof entry === 'object') {
                    if (typeof entry.id === 'string' && entry.options) {
                        this.registerLicenseAttestationProfilePack(entry.id, entry.options);
                    } else {
                        this.registerLicenseAttestationProfilePack(entry);
                    }
                }
            }
            return;
        }

        if (options.licenseAttestationProfilePackId) {
            this.registerLicenseAttestationProfilePack(
                options.licenseAttestationProfilePackId,
                options.licenseAttestationProfilePackOptions || {}
            );
        }
    }

    registerClassificationRule(rule) {
        const normalized = this.createClassificationRule(rule);
        this.classificationRules.unshift(normalized);
    }

    identify(identity, traits = {}, options = {}) {
        if (!this.enabled) return;
        if (!this.isLicensePermitted('identify')) {
            return;
        }

        const classification = options.classification || 'system';
        if (!this.isConsentGranted(classification)) {
            this.recordAudit('privacy.identity.blocked', { identity, classification });
            return;
        }

        const sanitizedTraits = this.sanitizePayload(traits);
        for (const provider of this.providers.values()) {
            provider.identify?.(identity, sanitizedTraits, { classification });
        }
    }

    track(event, payload = {}, options = {}) {
        if (!this.enabled) return;
        if (!this.isLicensePermitted('track', event)) {
            return;
        }

        const sanitizedPayload = this.sanitizePayload(payload);
        const classification = options.classification || this.classifyEvent(event, sanitizedPayload);

        if (!this.isConsentGranted(classification)) {
            this.recordAudit('privacy.event.blocked', { event, classification });
            return;
        }

        const record = {
            event,
            payload: sanitizedPayload,
            classification,
            licenseKey: this.dataMinimization.omitLicense ? undefined : this.licenseKey,
            timestamp: new Date().toISOString()
        };

        this.buffer.push(record);
        for (const provider of this.providers.values()) {
            provider.track?.(event, record, { classification });
        }
    }

    sanitizePayload(payload) {
        if (!payload || typeof payload !== 'object') return payload;
        const clone = { ...payload };

        if (this.dataMinimization.allowedFields) {
            const filtered = {};
            for (const key of this.dataMinimization.allowedFields) {
                if (key in clone) {
                    filtered[key] = clone[key];
                }
            }
            return filtered;
        }

        if (this.dataMinimization.anonymize) {
            delete clone.userId;
            delete clone.identity;
            delete clone.email;
        }

        return clone;
    }

    classifyEvent(event, payload) {
        for (const rule of this.classificationRules) {
            try {
                if (rule.test(event, payload)) {
                    return rule.classification;
                }
            } catch (error) {
                this.recordAudit('privacy.classification.error', { event, error: error.message });
            }
        }
        return this.defaultClassification;
    }

    isConsentGranted(classification) {
        if (!classification) return true;
        if (!this.consent.has(classification)) {
            return false;
        }
        return Boolean(this.consent.get(classification));
    }

    updateConsent(consentUpdates = {}, metadata = {}) {
        const applied = {};
        for (const [classification, value] of Object.entries(consentUpdates)) {
            this.consent.set(classification, Boolean(value));
            applied[classification] = Boolean(value);
        }

        const snapshot = this.getConsentSnapshot();
        this.recordAudit('privacy.consent.updated', { applied, metadata, snapshot });
        this.onConsentDecision?.(snapshot, metadata);
    }

    getConsentSnapshot() {
        return Object.fromEntries(this.consent.entries());
    }

    pushAuditEntry(entry) {
        this.auditLog.push(entry);
        if (this.auditLog.length > this.auditLogLimit) {
            this.auditLog.shift();
        }
    }

    recordAudit(event, payload = {}, classification = 'compliance') {
        const entry = {
            event,
            payload,
            classification,
            timestamp: new Date().toISOString()
        };

        this.pushAuditEntry(entry);

        for (const provider of this.providers.values()) {
            if (typeof provider.recordAudit === 'function') {
                try {
                    provider.recordAudit(entry);
                } catch (error) {
                    this.pushAuditEntry({
                        event: 'privacy.audit.provider_error',
                        payload: {
                            provider: provider.id,
                            sourceEvent: event,
                            message: error?.message || 'Unknown error'
                        },
                        classification: 'system',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }

        return entry;
    }

    getAuditTrail() {
        return [...this.auditLog];
    }

    getCommercializationSummary() {
        return this.commercializationReporter ? this.commercializationReporter.getSummary() : {
            packs: [],
            profiles: [],
            segments: {},
            regions: {},
            sla: {
                responseTargetMs: null,
                availabilityPercent: null,
                breachWindowMs: null
            },
            defaultProfileId: null,
            lastUpdated: null
        };
    }

    getCommercializationReporter() {
        return this.commercializationReporter || null;
    }

    getCommercializationSnapshotStore() {
        return this.commercializationSnapshotStore || null;
    }

    captureCommercializationSnapshot(context = {}) {
        if (!this.commercializationReporter || !this.commercializationSnapshotStore) {
            return null;
        }
        const summary = this.commercializationReporter.getSummary();
        const metadata = {
            ...context,
            trigger: context.trigger || 'manual-capture',
            capturedBy: context.capturedBy || 'telemetry-harness'
        };
        if (!this.dataMinimization?.omitLicense && this.licenseKey) {
            metadata.licenseKey = this.licenseKey;
        }
        return this.commercializationSnapshotStore.recordSnapshot(summary, metadata);
    }

    getCommercializationSnapshots(options = {}) {
        if (!this.commercializationSnapshotStore) {
            return [];
        }
        return this.commercializationSnapshotStore.getSnapshots(options);
    }

    getCommercializationKpiReport(options = {}) {
        if (!this.commercializationSnapshotStore) {
            return { latest: null, previous: null, deltas: {} };
        }
        return this.commercializationSnapshotStore.getKpiReport(options);
    }

    exportCommercializationSnapshots(options = {}) {
        if (!this.commercializationSnapshotStore) {
            return null;
        }
        return this.commercializationSnapshotStore.exportForBi(options);
    }

    startCommercializationSnapshotSchedule(intervalMs = 3600000, context = {}) {
        if (!this.commercializationReporter || !this.commercializationSnapshotStore) {
            return null;
        }
        const interval = Number(intervalMs);
        if (!Number.isFinite(interval) || interval <= 0) {
            throw new Error('Commercialization snapshot interval must be a positive number.');
        }
        this.stopCommercializationSnapshotSchedule();
        this.commercializationSnapshotScheduleContext = { ...context };
        this.commercializationSnapshotScheduleHandle = setInterval(() => {
            const scheduleContext = this.commercializationSnapshotScheduleContext || {};
            this.captureCommercializationSnapshot({
                ...scheduleContext,
                trigger: scheduleContext.trigger || 'scheduled-capture',
                scheduledAt: new Date().toISOString()
            });
        }, interval);
        return () => this.stopCommercializationSnapshotSchedule();
    }

    stopCommercializationSnapshotSchedule() {
        if (this.commercializationSnapshotScheduleHandle) {
            clearInterval(this.commercializationSnapshotScheduleHandle);
            this.commercializationSnapshotScheduleHandle = null;
            this.commercializationSnapshotScheduleContext = null;
        }
    }

    recordSchemaIssue({ type, issues, payload }) {
        this.recordAudit('compliance.schema.issue', { type, issues, payload });
        this.track('sensors.schema_issue', { type, issues, payload }, { classification: 'compliance' });
    }

    attachLicense(licenseKey) {
        this.licenseKey = licenseKey;
    }

    attachLicenseFromManager(license) {
        if (!license || !license.key) {
            this.attachLicense(null);
            return;
        }
        this.attachLicense(license.key);
    }

    setLicenseManager(manager) {
        if (this.licenseManagerSubscription) {
            this.licenseManagerSubscription();
            this.licenseManagerSubscription = null;
        }

        if (this.licenseAttestorDetach) {
            try {
                this.licenseAttestorDetach();
            } catch (error) {
                console?.warn?.('Failed to detach license attestor', error);
            }
            this.licenseAttestorDetach = null;
        }

        this.licenseManager = manager || null;
        if (!this.licenseManager) {
            this.licenseKey = null;
            if (this.licenseAttestor && typeof this.licenseAttestor.detach === 'function') {
                this.licenseAttestor.detach();
            }
            return;
        }

        this.attachLicenseFromManager(this.licenseManager.getLicense());
        if (typeof this.licenseManager.onStatusChange === 'function') {
            this.licenseManagerSubscription = this.licenseManager.onStatusChange(status => {
                if (status?.state === 'valid') {
                    this.attachLicenseFromManager(this.licenseManager.getLicense());
                } else if (status?.state === 'unregistered') {
                    this.attachLicense(null);
                }
            });
        }

        this.bindLicenseAttestor();
    }

    isLicensePermitted(action, event) {
        if (!this.licenseManager) return true;
        const status = this.licenseManager.getStatus();
        if (status.state === 'valid') return true;

        this.recordAudit('compliance.license.blocked', {
            action,
            event,
            status
        });
        return false;
    }

    start() {
        if (!this.enabled || this.flushHandle) return;
        this.flushHandle = setInterval(() => this.flush(), this.flushInterval);
    }

    stop() {
        if (this.flushHandle) {
            clearInterval(this.flushHandle);
            this.flushHandle = null;
        }
        if (this.licenseManagerSubscription) {
            this.licenseManagerSubscription();
            this.licenseManagerSubscription = null;
        }
        if (this.licenseAttestorDetach) {
            try {
                this.licenseAttestorDetach();
            } catch (error) {
                console?.warn?.('Failed to detach license attestor during stop', error);
            }
            this.licenseAttestorDetach = null;
        }
    }

    async flush() {
        if (!this.enabled) return;
        const pending = [];
        for (const provider of this.providers.values()) {
            const result = provider.flush?.();
            if (result instanceof Promise) {
                pending.push(result);
            }
        }
        this.buffer = [];
        if (pending.length) {
            await Promise.allSettled(pending);
        }
    }

    bindLicenseAttestor() {
        if (!this.licenseAttestor || this.licenseAttestorBindingOptions.bindToLicenseManager === false) {
            return;
        }
        if (!this.licenseManager || typeof this.licenseAttestor.bindToLicenseManager !== 'function') {
            return;
        }
        try {
            this.licenseAttestorDetach = this.licenseAttestor.bindToLicenseManager(
                this.licenseManager,
                this.licenseAttestorBindingOptions.attestorOptions || {}
            );
        } catch (error) {
            console?.warn?.('Failed to bind license attestor to manager', error);
        }
    }

    detachLicenseAttestorListeners() {
        if (Array.isArray(this.licenseAttestorSubscriptions)) {
            for (const unsubscribe of this.licenseAttestorSubscriptions) {
                try {
                    unsubscribe?.();
                } catch (error) {
                    console?.warn?.('Failed to unsubscribe attestor listener', error);
                }
            }
        }
        this.licenseAttestorSubscriptions = [];
    }

    setLicenseAttestor(attestor, bindingOptions = {}) {
        this.detachLicenseAttestorListeners();
        if (this.licenseAttestorDetach) {
            try {
                this.licenseAttestorDetach();
            } catch (error) {
                console?.warn?.('Failed to detach existing license attestor', error);
            }
        }
        this.licenseAttestorDetach = null;

        this.licenseAttestor = attestor || null;
        this.licenseAttestorBindingOptions = {
            bindToLicenseManager: bindingOptions.bindToLicenseManager ?? true,
            attestorOptions: bindingOptions.attestorOptions
        };

        if (!this.licenseAttestor) {
            return;
        }

        if (typeof this.licenseAttestor.on === 'function') {
            const subscribe = (event, handler) => {
                try {
                    const unsubscribe = this.licenseAttestor.on(event, handler);
                    if (typeof unsubscribe === 'function') {
                        this.licenseAttestorSubscriptions.push(unsubscribe);
                    } else if (typeof this.licenseAttestor.off === 'function') {
                        this.licenseAttestorSubscriptions.push(() => this.licenseAttestor.off(event, handler));
                    }
                } catch (error) {
                    console?.warn?.('Failed to subscribe to license attestor event', event, error);
                }
            };

            subscribe('attestation', payload => this.recordAudit('compliance.license.attestation', payload));
            subscribe('revocation', payload => this.recordAudit('compliance.license.revocation', payload));
            subscribe('entitlements', payload => this.recordAudit('compliance.license.entitlements', payload));
            subscribe('validation', payload => this.recordAudit('compliance.license.validation', payload));
            subscribe('schedule', payload => this.recordAudit('system.license.attestation_scheduled', payload, 'system'));
            subscribe('error', payload => this.recordAudit('compliance.license.attestor_error', payload, 'system'));
        }

        this.bindLicenseAttestor();
    }
}
