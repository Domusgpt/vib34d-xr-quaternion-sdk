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

function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return min;
    }
    return Math.min(Math.max(number, min), max);
}

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function toString(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}

function asBoolean(value) {
    return Boolean(value);
}

function cloneValue(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

function normalizeFieldDefinition(field, definition = {}) {
    if (typeof definition === 'function') {
        return {
            name: field,
            transform: definition,
            required: false,
            allowNull: true,
            allowUndefined: true,
            redact: false,
            anonymize: false,
            type: null,
            validate: null,
            defaultValue: undefined
        };
    }

    const {
        transform,
        sanitize,
        required = false,
        allowNull = false,
        allowUndefined,
        redact = false,
        anonymize = false,
        type = null,
        validate = null,
        defaultValue,
        default: aliasDefault,
        enumeration
    } = definition;

    const validator = typeof validate === 'function'
        ? validate
        : Array.isArray(enumeration)
            ? value => enumeration.includes(value) || `Value must be one of: ${enumeration.join(', ')}`
            : null;

    return {
        name: field,
        transform: typeof transform === 'function' ? transform : (typeof sanitize === 'function' ? sanitize : null),
        required: Boolean(required),
        allowNull: Boolean(allowNull),
        allowUndefined: typeof allowUndefined === 'boolean' ? allowUndefined : !required,
        redact: Boolean(redact),
        anonymize,
        type: typeof type === 'string' ? type : null,
        validate: validator,
        defaultValue: defaultValue !== undefined ? defaultValue : aliasDefault
    };
}

function normalizeEventSchema(event, schema = {}) {
    const {
        classification = null,
        fields = {},
        allowUnknownFields = false,
        dropOnValidationError = true,
        metadata,
        analytics = {}
    } = schema;

    const normalizedFields = new Map();
    for (const [field, definition] of Object.entries(fields)) {
        normalizedFields.set(field, normalizeFieldDefinition(field, definition));
    }

    return {
        event,
        classification: classification || null,
        fields: normalizedFields,
        allowUnknownFields: Boolean(allowUnknownFields),
        dropOnValidationError: dropOnValidationError !== false,
        metadata: metadata && typeof metadata === 'object' ? { ...metadata } : undefined,
        analytics: analytics && typeof analytics === 'object' ? { ...analytics } : {}
    };
}

function anonymizeValue(value) {
    if (typeof value === 'string') {
        return value.length <= 3 ? '***' : `${value.slice(0, 1)}***${value.slice(-1)}`;
    }
    if (typeof value === 'number') {
        return 0;
    }
    if (typeof value === 'boolean') {
        return false;
    }
    if (Array.isArray(value)) {
        return value.map(item => anonymizeValue(item));
    }
    if (value && typeof value === 'object') {
        const clone = {};
        for (const key of Object.keys(value)) {
            clone[key] = anonymizeValue(value[key]);
        }
        return clone;
    }
    return null;
}

function applyFieldDefinition(fieldDefinition, payload, context = {}) {
    let value = payload[fieldDefinition.name];

    if ((value === undefined || value === null) && fieldDefinition.defaultValue !== undefined) {
        value = typeof fieldDefinition.defaultValue === 'function'
            ? fieldDefinition.defaultValue(payload, context)
            : cloneValue(fieldDefinition.defaultValue);
    }

    if ((value === undefined && !fieldDefinition.allowUndefined) || (value === null && !fieldDefinition.allowNull)) {
        if (fieldDefinition.required) {
            return { error: `Field "${fieldDefinition.name}" is required.` };
        }
        if (value === undefined) {
            return { skip: true };
        }
    }

    if (fieldDefinition.transform) {
        try {
            value = fieldDefinition.transform(value, payload, context);
        } catch (error) {
            return { error: `Field "${fieldDefinition.name}" transform failed: ${error?.message || error}` };
        }
    }

    if (fieldDefinition.type && value !== undefined && value !== null) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== fieldDefinition.type) {
            return { error: `Field "${fieldDefinition.name}" must be of type ${fieldDefinition.type}.` };
        }
    }

    if (fieldDefinition.validate) {
        try {
            const result = fieldDefinition.validate(value, payload, context);
            if (result === false) {
                return { error: `Field "${fieldDefinition.name}" failed validation.` };
            }
            if (typeof result === 'string') {
                return { error: result };
            }
        } catch (error) {
            return { error: `Field "${fieldDefinition.name}" validation error: ${error?.message || error}` };
        }
    }

    if (fieldDefinition.redact) {
        return { skip: true };
    }

    if (fieldDefinition.anonymize) {
        value = typeof fieldDefinition.anonymize === 'function'
            ? fieldDefinition.anonymize(value, payload, context)
            : anonymizeValue(value);
    }

    return { value };
}

function applyEventSchemaDefinition(schema, payload = {}, context = {}) {
    if (!schema) {
        return { payload: cloneValue(payload), classification: null };
    }

    const normalizedPayload = {};
    const errors = [];
    for (const fieldDefinition of schema.fields.values()) {
        const { error, value, skip } = applyFieldDefinition(fieldDefinition, payload, context);
        if (error) {
            errors.push(error);
            continue;
        }
        if (skip) {
            continue;
        }
        normalizedPayload[fieldDefinition.name] = cloneValue(value);
    }

    if (errors.length) {
        return { errors };
    }

    if (schema.allowUnknownFields) {
        for (const [key, value] of Object.entries(payload || {})) {
            if (!schema.fields.has(key)) {
                normalizedPayload[key] = cloneValue(value);
            }
        }
    }

    return {
        payload: normalizedPayload,
        classification: schema.classification
    };
}

const DEFAULT_EVENT_SCHEMAS = [
    {
        event: 'adaptive.focus',
        classification: 'interaction',
        fields: {
            x: value => clampNumber(toNumber(value, 0), -1, 1),
            y: value => clampNumber(toNumber(value, 0), -1, 1),
            depth: value => clampNumber(toNumber(value, 0), 0, 1)
        }
    },
    {
        event: 'adaptive.gesture',
        classification: 'interaction',
        fields: {
            intent: { required: true, transform: toString }
        }
    },
    {
        event: 'design.layout.strategy_registered',
        classification: 'analytics',
        fields: {
            id: { required: true, transform: toString }
        }
    },
    {
        event: 'design.layout.annotation_registered',
        classification: 'analytics',
        fields: {
            id: { required: true, transform: toString }
        }
    },
    {
        event: 'design.telemetry.provider_registered',
        classification: 'system',
        fields: {
            id: { required: true, transform: toString }
        }
    },
    {
        event: 'design.telemetry.provider_removed',
        classification: 'system',
        fields: {
            id: { required: true, transform: toString }
        }
    },
    {
        event: 'design.spec.activated',
        classification: 'analytics',
        fields: {
            specId: { transform: toString },
            channel: { transform: toString },
            metadata: { transform: (value = {}) => cloneValue(value) }
        },
        allowUnknownFields: false
    },
    {
        event: 'sensors.adapter.registered',
        classification: 'system',
        fields: {
            type: { required: true, transform: toString },
            autoConnect: { transform: asBoolean },
            metadata: { transform: value => cloneValue(value || {}) }
        }
    },
    {
        event: 'sensors.adapter.connected',
        classification: 'system',
        fields: {
            type: { required: true, transform: toString },
            metadata: { transform: value => cloneValue(value || {}) }
        }
    },
    {
        event: 'sensors.adapter.disconnected',
        classification: 'system',
        fields: {
            type: { required: true, transform: toString }
        }
    },
    {
        event: 'sensors.adapter.connect_failed',
        classification: 'system',
        fields: {
            type: { required: true, transform: toString },
            error: { transform: value => toString(value || 'unknown') }
        }
    },
    {
        event: 'sensors.adapter.disconnect_failed',
        classification: 'system',
        fields: {
            type: { required: true, transform: toString },
            error: { transform: value => toString(value || 'unknown') }
        }
    },
    {
        event: 'sensors.adapter.tested',
        classification: 'system',
        fields: {
            type: { required: true, transform: toString },
            result: { transform: value => cloneValue(value ?? null) }
        }
    },
    {
        event: 'sensors.schema_registered',
        classification: 'compliance',
        fields: {
            type: { required: true, transform: toString }
        }
    },
    {
        event: 'sensors.schema_issue',
        classification: 'compliance',
        fields: {
            type: { required: true, transform: toString },
            issues: { transform: value => cloneValue(value || []) },
            payload: { transform: value => cloneValue(value || {}) }
        }
    },
    {
        event: 'privacy.consent.updated',
        classification: 'compliance',
        fields: {
            applied: { transform: value => cloneValue(value || {}) },
            metadata: { transform: value => {
                const clone = cloneValue(value || {});
                if (clone.licenseKey) {
                    delete clone.licenseKey;
                }
                if (clone.user) {
                    delete clone.user;
                }
                return clone;
            } },
            snapshot: { transform: value => cloneValue(value || {}) }
        }
    },
    {
        event: 'privacy.event.blocked',
        classification: 'compliance',
        fields: {
            event: { required: true, transform: toString },
            classification: { transform: toString }
        }
    },
    {
        event: 'privacy.identity.blocked',
        classification: 'compliance',
        fields: {
            identity: { transform: value => anonymizeValue(value) },
            classification: { transform: toString }
        }
    },
    {
        event: 'compliance.license.blocked',
        classification: 'compliance',
        fields: {
            action: { transform: toString },
            event: { transform: value => value ? toString(value) : undefined },
            status: { transform: value => cloneValue(value || {}) }
        }
    },
    {
        event: 'system.license.attestation_profile_registered',
        classification: 'system',
        fields: {
            profileId: { required: true, transform: toString },
            metadata: { transform: value => cloneValue(value || {}) }
        }
    },
    {
        event: 'system.license.attestation_profile_pack_registered',
        classification: 'system',
        fields: {
            packId: { required: true, transform: toString },
            profileIds: { transform: value => Array.isArray(value) ? value.map(toString) : [] }
        }
    },
    {
        event: 'system.license.attestation_profile_default',
        classification: 'system',
        fields: {
            profileId: { transform: value => value ? toString(value) : null }
        }
    },
    {
        event: 'system.license.attestation_profile_applied',
        classification: 'system',
        fields: {
            profileId: { required: true, transform: toString },
            sla: { transform: value => cloneValue(value || null) }
        }
    },
    {
        event: 'system.license.attestation_scheduled',
        classification: 'system',
        fields: {
            nextCheckAt: { transform: value => value ? toString(value) : null },
            reason: { transform: value => value ? toString(value) : null }
        }
    },
    {
        event: 'compliance.license.attestation',
        classification: 'compliance',
        fields: {
            valid: { transform: asBoolean },
            reason: { transform: value => value ? toString(value) : null },
            attestedAt: { transform: value => value ? toString(value) : null }
        }
    },
    {
        event: 'compliance.license.attestor_error',
        classification: 'system',
        fields: {
            error: { transform: value => value ? toString(value) : 'Unknown error' }
        }
    },
    {
        event: 'compliance.license.revocation',
        classification: 'compliance',
        fields: {
            revoked: { transform: asBoolean },
            reason: { transform: value => value ? toString(value) : null }
        }
    },
    {
        event: 'compliance.license.entitlements',
        classification: 'compliance',
        fields: {
            entitlements: { transform: value => Array.isArray(value) ? value.map(toString) : [] }
        }
    },
    {
        event: 'compliance.license.validation',
        classification: 'compliance',
        fields: {
            state: { transform: value => value ? toString(value) : null },
            metadata: { transform: value => cloneValue(value || {}) }
        }
    }
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

        this.eventSchemas = new Map();
        this.registerDefaultEventSchemas();
        if (Array.isArray(options.eventSchemas)) {
            this.registerEventSchemas(options.eventSchemas);
        } else if (options.eventSchemas && typeof options.eventSchemas === 'object') {
            this.registerEventSchemas(options.eventSchemas);
        }

        this.analytics = {
            totalCount: 0,
            events: new Map(),
            classifications: new Map(),
            firstEventAt: null,
            lastEventAt: null
        };

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

    registerDefaultEventSchemas() {
        for (const schema of DEFAULT_EVENT_SCHEMAS) {
            if (!schema || !schema.event) continue;
            if (this.eventSchemas.has(schema.event)) {
                continue;
            }
            this.eventSchemas.set(schema.event, normalizeEventSchema(schema.event, schema));
        }
    }

    registerEventSchema(eventOrSchema, schema) {
        let eventId = eventOrSchema;
        let definition = schema;
        if (eventOrSchema && typeof eventOrSchema === 'object' && eventOrSchema.event) {
            eventId = eventOrSchema.event;
            definition = eventOrSchema;
        }

        if (!eventId || typeof eventId !== 'string') {
            throw new Error('registerEventSchema requires an event id.');
        }

        const normalized = normalizeEventSchema(eventId, definition || {});
        this.eventSchemas.set(eventId, normalized);
        return this.getEventSchema(eventId);
    }

    registerEventSchemas(collection) {
        if (!collection) {
            return [];
        }
        if (Array.isArray(collection)) {
            return collection.map(entry => this.registerEventSchema(entry));
        }
        if (typeof collection === 'object') {
            const results = [];
            for (const [eventId, schema] of Object.entries(collection)) {
                results.push(this.registerEventSchema(eventId, schema));
            }
            return results;
        }
        return [];
    }

    removeEventSchema(eventId) {
        return this.eventSchemas.delete(eventId);
    }

    getEventSchema(eventId) {
        const schema = this.eventSchemas.get(eventId);
        if (!schema) {
            return null;
        }
        const fields = {};
        for (const [name, definition] of schema.fields.entries()) {
            fields[name] = {
                required: definition.required,
                allowNull: definition.allowNull,
                allowUndefined: definition.allowUndefined,
                redact: definition.redact,
                anonymize: definition.anonymize,
                type: definition.type,
                defaultValue: definition.defaultValue
            };
        }
        return {
            event: schema.event,
            classification: schema.classification,
            allowUnknownFields: schema.allowUnknownFields,
            metadata: schema.metadata ? { ...schema.metadata } : undefined,
            analytics: schema.analytics ? { ...schema.analytics } : {},
            fields
        };
    }

    getEventSchemas() {
        return Array.from(this.eventSchemas.keys()).map(eventId => this.getEventSchema(eventId));
    }

    prepareEventPayload(event, payload, context = {}) {
        const schema = this.eventSchemas.get(event) || null;
        const result = applyEventSchemaDefinition(schema, payload, { ...context, event });
        return { ...result, schema };
    }

    recordAnalytics(event, classification, payload, timestamp = new Date().toISOString()) {
        const normalizedClassification = classification || 'unclassified';
        const eventStats = this.analytics.events.get(event) || {
            count: 0,
            classifications: {},
            lastTimestamp: null,
            samplePayload: null
        };
        eventStats.count += 1;
        eventStats.lastTimestamp = timestamp;
        eventStats.classifications[normalizedClassification] = (eventStats.classifications[normalizedClassification] || 0) + 1;
        if (!eventStats.samplePayload) {
            eventStats.samplePayload = cloneValue(payload);
        }
        this.analytics.events.set(event, eventStats);

        const classStats = this.analytics.classifications.get(normalizedClassification) || {
            count: 0,
            lastTimestamp: null
        };
        classStats.count += 1;
        classStats.lastTimestamp = timestamp;
        this.analytics.classifications.set(normalizedClassification, classStats);

        this.analytics.totalCount += 1;
        if (!this.analytics.firstEventAt) {
            this.analytics.firstEventAt = timestamp;
        }
        this.analytics.lastEventAt = timestamp;
    }

    getAnalyticsSummary(options = {}) {
        const includeSamples = options.includeSamples ?? false;
        return {
            totalEvents: this.analytics.totalCount,
            firstEventAt: this.analytics.firstEventAt,
            lastEventAt: this.analytics.lastEventAt,
            events: Array.from(this.analytics.events.entries()).map(([event, stats]) => ({
                event,
                count: stats.count,
                lastTimestamp: stats.lastTimestamp,
                classifications: { ...stats.classifications },
                ...(includeSamples && stats.samplePayload ? { samplePayload: cloneValue(stats.samplePayload) } : {})
            })),
            classifications: Array.from(this.analytics.classifications.entries()).map(([classification, stats]) => ({
                classification,
                count: stats.count,
                lastTimestamp: stats.lastTimestamp
            }))
        };
    }

    resetAnalyticsSummary() {
        this.analytics = {
            totalCount: 0,
            events: new Map(),
            classifications: new Map(),
            firstEventAt: null,
            lastEventAt: null
        };
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

        const schemaResult = this.prepareEventPayload(event, payload, options.schemaContext || options.context || {});
        if (schemaResult.errors && (!schemaResult.schema || schemaResult.schema.dropOnValidationError !== false)) {
            this.recordAudit('privacy.schema.validation_failed', {
                event,
                errors: schemaResult.errors,
                classification: schemaResult.schema?.classification || null
            });
            return;
        }

        let normalizedPayload = schemaResult.payload || cloneValue(payload);
        if (schemaResult.errors) {
            this.recordAudit('privacy.schema.validation_failed', {
                event,
                errors: schemaResult.errors,
                classification: schemaResult.schema?.classification || null,
                suppressed: true
            });
            normalizedPayload = cloneValue(payload);
        }

        const sanitizedPayload = this.sanitizePayload(normalizedPayload);
        const classification = options.classification
            || schemaResult.classification
            || this.classifyEvent(event, sanitizedPayload);

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
        this.recordAnalytics(event, classification, sanitizedPayload, record.timestamp);
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
        const schemaResult = this.prepareEventPayload(event, payload, { mode: 'audit' });
        if (schemaResult.errors && (!schemaResult.schema || schemaResult.schema.dropOnValidationError !== false)) {
            this.pushAuditEntry({
                event: 'privacy.schema.validation_failed',
                payload: {
                    event,
                    errors: schemaResult.errors,
                    classification: classification || schemaResult.classification || 'compliance',
                    mode: 'audit'
                },
                classification: 'compliance',
                timestamp: new Date().toISOString()
            });
        }

        let normalizedPayload = schemaResult.payload || cloneValue(payload);
        if (schemaResult.errors && schemaResult.schema && schemaResult.schema.dropOnValidationError === false) {
            this.pushAuditEntry({
                event: 'privacy.schema.validation_failed',
                payload: {
                    event,
                    errors: schemaResult.errors,
                    classification: classification || schemaResult.classification || 'compliance',
                    mode: 'audit',
                    suppressed: true
                },
                classification: 'compliance',
                timestamp: new Date().toISOString()
            });
        }

        const payloadForStorage = this.sanitizePayload(normalizedPayload);
        const resolvedClassification = classification || schemaResult.classification || 'compliance';
        const timestamp = new Date().toISOString();

        const entry = {
            event,
            payload: payloadForStorage,
            classification: resolvedClassification,
            timestamp
        };

        this.pushAuditEntry(entry);
        this.recordAnalytics(event, resolvedClassification, payloadForStorage, timestamp);

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
