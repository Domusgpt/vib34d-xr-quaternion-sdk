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
    'start',
    'stop',
    'updateConsent',
    'getConsentSnapshot',
    'recordAudit',
    'recordSchemaIssue',
    'setConsentDecisionHandler'
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
