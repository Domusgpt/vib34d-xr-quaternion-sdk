const DEFAULT_METHOD_CONFIG = {
    registerProvider: { target: 'registerProvider', returnOwner: true, hook: 'onProviderRegistered' },
    removeProvider: { target: 'removeProvider', returnOwner: true, hook: 'onProviderRemoved' },
    registerRequestMiddleware: { target: 'registerRequestMiddleware', returnOwner: true },
    clearRequestMiddleware: { target: 'clearRequestMiddleware', returnOwner: true, hook: 'onRequestMiddlewareCleared' },
    registerLicenseAttestationProfile: { target: 'registerLicenseAttestationProfile' },
    registerLicenseAttestationProfilePack: { target: 'registerLicenseAttestationProfilePack' },
    getLicenseAttestationProfiles: { target: 'getLicenseAttestationProfiles' },
    getLicenseAttestationProfile: { target: 'getLicenseAttestationProfile' },
    setDefaultLicenseAttestationProfile: { target: 'setDefaultLicenseAttestationProfile', returnOwner: true, hook: 'onDefaultAttestationProfileChanged' },
    setLicenseAttestorFromProfile: { target: 'setLicenseAttestorFromProfile' },
    setLicenseManager: { target: 'setLicenseManager', returnOwner: true },
    setLicenseAttestor: { target: 'setLicenseAttestor', returnOwner: true },
    getAuditTrail: { target: 'getAuditTrail' },
    getCommercializationSummary: { target: 'getCommercializationSummary' },
    getCommercializationReporter: { target: 'getCommercializationReporter' },
    getCommercializationSnapshotStore: { target: 'getCommercializationSnapshotStore' },
    captureCommercializationSnapshot: { target: 'captureCommercializationSnapshot' },
    getCommercializationSnapshots: { target: 'getCommercializationSnapshots' },
    getCommercializationKpiReport: { target: 'getCommercializationKpiReport' },
    exportCommercializationSnapshots: { target: 'exportCommercializationSnapshots' },
    startCommercializationSnapshotSchedule: {
        target: 'startCommercializationSnapshotSchedule',
        hook: 'onCommercializationScheduleStarted'
    },
    stopCommercializationSnapshotSchedule: {
        target: 'stopCommercializationSnapshotSchedule',
        returnOwner: true,
        hook: 'onCommercializationScheduleStopped'
    }
};

const DEFAULT_BLUEPRINT_RETENTION_DAYS = 30;

function normalizeEventDescriptor(event, fallbackConsent) {
    if (!event) {
        throw new Error('createTelemetryProviderBlueprint requires event descriptors.');
    }

    if (typeof event === 'string') {
        return {
            name: event,
            description: '',
            consent: fallbackConsent,
            pii: []
        };
    }

    const name = typeof event.name === 'string' && event.name
        ? event.name
        : event.event || event.id;
    if (!name) {
        throw new Error('Event descriptors must include a name.');
    }

    const pii = Array.isArray(event.pii)
        ? [...new Set(event.pii.filter(Boolean))]
        : [];

    return {
        name,
        description: typeof event.description === 'string' ? event.description : '',
        consent: event.consent || fallbackConsent,
        pii,
        metadata: event.metadata || {}
    };
}

export function createTelemetryProviderBlueprint({
    id,
    description = '',
    events,
    consentClassification = 'analytics',
    retentionDays = DEFAULT_BLUEPRINT_RETENTION_DAYS,
    piiCategories = [],
    metadata = {}
} = {}) {
    if (!id || typeof id !== 'string') {
        throw new Error('createTelemetryProviderBlueprint requires a provider id.');
    }
    if (!Array.isArray(events) || events.length === 0) {
        throw new Error('createTelemetryProviderBlueprint requires at least one event descriptor.');
    }

    const normalizedEvents = events.map(event => normalizeEventDescriptor(event, consentClassification));
    const normalizedRetention = Number.isFinite(retentionDays)
        ? Math.max(1, Math.floor(retentionDays))
        : DEFAULT_BLUEPRINT_RETENTION_DAYS;
    const pii = new Set(piiCategories.filter(Boolean));
    for (const descriptor of normalizedEvents) {
        for (const category of descriptor.pii) {
            pii.add(category);
        }
    }

    return Object.freeze({
        id,
        description,
        consentClassification,
        retentionDays: normalizedRetention,
        piiCategories: [...pii],
        events: normalizedEvents,
        metadata
    });
}

export function createConsentExportBundle(harness, {
    format = 'json',
    classification = 'consent.export',
    revision = 1,
    timestamp = Date.now(),
    metadata = {}
} = {}) {
    if (!harness || typeof harness.getConsentSnapshot !== 'function') {
        throw new Error('createConsentExportBundle requires a ProductTelemetryHarness instance.');
    }

    const consent = harness.getConsentSnapshot();
    const auditTrail = typeof harness.getAuditTrail === 'function'
        ? harness.getAuditTrail()
        : [];
    const generatedAt = new Date(timestamp).toISOString();
    const envelope = {
        classification,
        revision,
        generatedAt,
        metadata: { ...metadata }
    };

    if (format === 'csv') {
        const rows = [['classification', 'enabled']];
        for (const [key, value] of Object.entries(consent || {})) {
            rows.push([key, String(Boolean(value))]);
        }
        return {
            format: 'csv',
            payload: rows.map(row => row.join(',')).join('\n'),
            consent,
            auditTrail,
            envelope
        };
    }

    return {
        format: 'json',
        payload: {
            consent,
            auditTrail,
            envelope
        }
    };
}

function bindMethod(harness, config, owner, hooks) {
    const implementation = harness?.[config.target];
    if (typeof implementation !== 'function') {
        return undefined;
    }

    return (...args) => {
        const result = implementation.apply(harness, args);
        if (config.hook && typeof hooks?.[config.hook] === 'function') {
            hooks[config.hook](...args, result);
        }
        return config.returnOwner ? owner : result;
    };
}

const DIRECT_METHODS = [
    'track',
    'identify',
    'flush',
    'deliverBatch',
    'flushBatches',
    'start',
    'stop',
    'updateConsent',
    'getConsentSnapshot',
    'recordAudit',
    'recordSchemaIssue',
    'setConsentDecisionHandler',
    'getTelemetryBatcher'
];

export function createTelemetryFacade({ harness, owner, hooks } = {}) {
    if (!harness) {
        throw new Error('createTelemetryFacade requires a ProductTelemetryHarness instance.');
    }

    const targetOwner = owner || harness;
    const appliedHooks = hooks || {};
    const facade = {};

    for (const method of DIRECT_METHODS) {
        if (typeof harness[method] === 'function') {
            facade[method] = harness[method].bind(harness);
        }
    }

    for (const [alias, config] of Object.entries(DEFAULT_METHOD_CONFIG)) {
        const bound = bindMethod(harness, config, targetOwner, appliedHooks);
        if (bound) {
            facade[alias] = bound;
        }
    }

    facade.createProviderBlueprint = blueprint => createTelemetryProviderBlueprint(blueprint);
    facade.exportConsentBundle = options => createConsentExportBundle(harness, options);

    return facade;
}

export function applyTelemetryFacade(target, { harness, owner, hooks } = {}) {
    if (!target || !harness) {
        throw new Error('applyTelemetryFacade requires both a target and a ProductTelemetryHarness instance.');
    }

    const facade = createTelemetryFacade({ harness, owner: owner || target, hooks });
    Object.assign(target, facade);
    return facade;
}
