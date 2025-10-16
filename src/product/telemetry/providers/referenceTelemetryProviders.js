import { ConsoleTelemetryProvider } from '../ConsoleTelemetryProvider.js';
import { HttpTelemetryProvider } from '../HttpTelemetryProvider.js';
import { ComplianceVaultTelemetryProvider } from '../ComplianceVaultTelemetryProvider.js';
import {
    createConsentExportBundle,
    createTelemetryProviderBlueprint
} from '../createTelemetryFacade.js';

function cloneEvents(events) {
    return events.map(event =>
        typeof event === 'string'
            ? event
            : { ...event, pii: Array.isArray(event.pii) ? [...event.pii] : [] }
    );
}

function mergeBlueprintInput(base, overrides = {}) {
    const merged = {
        ...base,
        ...overrides
    };

    if (overrides.metadata) {
        merged.metadata = { ...base.metadata, ...overrides.metadata };
    } else {
        merged.metadata = { ...base.metadata };
    }

    if (overrides.piiCategories) {
        merged.piiCategories = [...new Set(overrides.piiCategories.filter(Boolean))];
    } else {
        merged.piiCategories = [...base.piiCategories];
    }

    if (overrides.events) {
        if (!Array.isArray(overrides.events) || overrides.events.length === 0) {
            throw new Error('Reference telemetry blueprints require at least one event.');
        }
        merged.events = cloneEvents(overrides.events);
    } else {
        merged.events = cloneEvents(base.events);
    }

    return merged;
}

function buildConsoleBlueprintInput(overrides = {}) {
    const base = {
        id: 'console',
        description: 'Local console telemetry for development visibility.',
        consentClassification: 'analytics',
        retentionDays: 2,
        piiCategories: ['deviceId'],
        events: cloneEvents([
            {
                name: 'adaptive.session.started',
                description: 'XR runtime session started.',
                metadata: { stage: 'runtime' }
            },
            {
                name: 'adaptive.session.ended',
                description: 'XR runtime session finished.',
                metadata: { stage: 'runtime' }
            },
            {
                name: 'adaptive.ui.interaction',
                description: 'User interaction routed through adaptive engine.',
                metadata: { channel: 'interaction' }
            },
            {
                name: 'design.telemetry.debug-log',
                consent: 'system',
                description: 'Structured debug log emitted during development.',
                metadata: { channel: 'diagnostic' }
            }
        ]),
        metadata: {
            transport: 'console',
            recommendedEnvironment: 'development'
        }
    };

    return mergeBlueprintInput(base, overrides);
}

function buildHttpBlueprintInput(overrides = {}) {
    const base = {
        id: 'http',
        description: 'HTTP telemetry collector for analytics and product telemetry.',
        consentClassification: 'analytics',
        retentionDays: 30,
        piiCategories: ['deviceId', 'sessionId'],
        events: cloneEvents([
            {
                name: 'analytics.session.start',
                description: 'Session started event delivered to analytics backend.',
                metadata: { channel: 'session' }
            },
            {
                name: 'analytics.session.end',
                description: 'Session ended event delivered to analytics backend.',
                metadata: { channel: 'session' }
            },
            {
                name: 'adaptive.localization.anchor-changed',
                description: 'Localization anchor swap detected by quaternion fabric.',
                metadata: { channel: 'localization' }
            },
            {
                name: 'commerce.feature.opt-in',
                consent: 'marketing',
                description: 'User opted into a commerce-facing XR feature.',
                pii: ['userId'],
                metadata: { channel: 'engagement' }
            }
        ]),
        metadata: {
            transport: 'https',
            batching: true
        }
    };

    return mergeBlueprintInput(base, overrides);
}

function buildComplianceVaultBlueprintInput(overrides = {}) {
    const base = {
        id: 'compliance-vault',
        description: 'In-memory or localStorage vault for compliance event retention.',
        consentClassification: 'compliance',
        retentionDays: 365,
        piiCategories: ['licenseKey'],
        events: cloneEvents([
            {
                name: 'compliance.license.snapshot-recorded',
                description: 'License commercialization snapshot captured for auditing.',
                metadata: { source: 'telemetry-harness' }
            },
            {
                name: 'privacy.request.exported',
                description: 'User privacy export request fulfilled.',
                metadata: { source: 'privacy' }
            },
            {
                name: 'privacy.request.deleted',
                description: 'User privacy deletion request fulfilled.',
                metadata: { source: 'privacy' }
            },
            {
                name: 'security.audit.event',
                description: 'Security-critical audit event persisted locally.',
                metadata: { source: 'security' }
            }
        ]),
        metadata: {
            transport: 'local-vault',
            encryption: false
        }
    };

    return mergeBlueprintInput(base, overrides);
}

function shouldEnable(config = {}) {
    return config?.enabled !== false;
}

function createProviderInstance(ProviderCtor, config = {}, defaults = {}) {
    if (config?.provider) {
        return config.provider;
    }
    const options = {
        ...defaults,
        ...(config?.providerOptions || {})
    };
    return new ProviderCtor(options);
}

export function createReferenceTelemetryBlueprints(options = {}) {
    const catalog = {};

    if (shouldEnable(options.console)) {
        catalog.console = createTelemetryProviderBlueprint(
            buildConsoleBlueprintInput(options.console?.blueprint)
        );
    }

    if (shouldEnable(options.http)) {
        catalog.http = createTelemetryProviderBlueprint(
            buildHttpBlueprintInput(options.http?.blueprint)
        );
    }

    if (shouldEnable(options.complianceVault)) {
        catalog.complianceVault = createTelemetryProviderBlueprint(
            buildComplianceVaultBlueprintInput(options.complianceVault?.blueprint)
        );
    }

    return catalog;
}

export function registerReferenceTelemetryProviders(harness, options = {}) {
    if (!harness || typeof harness.registerProvider !== 'function') {
        throw new Error('registerReferenceTelemetryProviders requires a ProductTelemetryHarness instance.');
    }

    const blueprints = createReferenceTelemetryBlueprints(options);
    const registrations = {};

    if (blueprints.console) {
        const provider = createProviderInstance(
            ConsoleTelemetryProvider,
            options.console,
            { log: options.console?.log ?? false }
        );
        if (typeof harness.removeProvider === 'function') {
            harness.removeProvider(provider.id);
        }
        harness.registerProvider(provider);
        registrations.console = { provider, blueprint: blueprints.console };
    }

    if (blueprints.http) {
        const provider = createProviderInstance(
            HttpTelemetryProvider,
            options.http,
            {
                endpoint: options.http?.endpoint || 'https://telemetry.example.com/collect',
                requestMiddleware: options.http?.requestMiddleware
            }
        );
        if (typeof harness.removeProvider === 'function') {
            harness.removeProvider(provider.id);
        }
        harness.registerProvider(provider);
        registrations.http = { provider, blueprint: blueprints.http };
    }

    if (blueprints.complianceVault) {
        const provider = createProviderInstance(
            ComplianceVaultTelemetryProvider,
            options.complianceVault,
            {
                storageKey: options.complianceVault?.storageKey || 'vib34d:compliance-vault',
                includeClassifications: options.complianceVault?.includeClassifications
            }
        );
        if (typeof harness.removeProvider === 'function') {
            harness.removeProvider(provider.id);
        }
        harness.registerProvider(provider);
        registrations.complianceVault = { provider, blueprint: blueprints.complianceVault };
    }

    let consentBundle = null;
    const consentOptions = options.consentBundle;
    const shouldExportConsent = consentOptions !== false;

    if (shouldExportConsent) {
        const exportOptions = typeof consentOptions === 'object' && consentOptions !== null
            ? { ...consentOptions }
            : {};
        exportOptions.metadata = {
            exportedBy: 'registerReferenceTelemetryProviders',
            ...(exportOptions.metadata || {})
        };
        const bundle = createConsentExportBundle(harness, exportOptions);
        if (bundle && !bundle.envelope && bundle.payload && typeof bundle.payload === 'object') {
            const envelope = bundle.payload.envelope;
            consentBundle = envelope
                ? { ...bundle, envelope }
                : bundle;
        } else {
            consentBundle = bundle;
        }
    }

    return {
        providers: registrations,
        blueprints,
        consentBundle
    };
}
