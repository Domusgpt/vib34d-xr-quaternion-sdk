import { AdaptiveInterfaceEngine } from './AdaptiveInterfaceEngine.js';
import { createConsentPanel as baseCreateConsentPanel } from '../ui/components/ConsentPanel.js';
import { LicenseManager } from '../product/licensing/LicenseManager.js';
import { RemoteLicenseAttestor } from '../product/licensing/RemoteLicenseAttestor.js';
import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';

export function createAdaptiveSDK(config = {}) {
    const telemetryOptions = { ...(config.telemetry || {}) };
    if (config.replaceDefaultProviders) {
        telemetryOptions.useDefaultProvider = false;
    }

    if (Array.isArray(config.licenseAttestationProfilePacks)) {
        telemetryOptions.licenseAttestationProfilePacks = config.licenseAttestationProfilePacks;
    }
    if (config.licenseAttestationProfilePackId) {
        telemetryOptions.licenseAttestationProfilePackId = config.licenseAttestationProfilePackId;
    }
    if (config.licenseAttestationProfilePackOptions) {
        telemetryOptions.licenseAttestationProfilePackOptions = config.licenseAttestationProfilePackOptions;
    }

    if (config.commercialization) {
        telemetryOptions.commercialization = config.commercialization;
    }

    if (config.commercializationReporter) {
        telemetryOptions.commercializationReporter = config.commercializationReporter;
    }

    if (Array.isArray(config.licenseAttestationProfiles)) {
        telemetryOptions.licenseAttestationProfiles = config.licenseAttestationProfiles;
    }
    if (config.defaultLicenseAttestationProfileId) {
        telemetryOptions.defaultLicenseAttestationProfileId = config.defaultLicenseAttestationProfileId;
    }

    let pendingLicenseAttestorProfileId = config.licenseAttestorProfileId || null;
    let pendingLicenseAttestorProfileOverrides = { ...(config.licenseAttestorProfileOverrides || {}) };

    let licenseManager = config.licenseManager || null;
    let licenseAttestor = null;
    let licenseAttestorBindingOptions = {};
    if (!licenseManager && config.license) {
        const {
            validators,
            autoValidate = true,
            managerOptions = {},
            attestor,
            attestorBinding = {},
            attestorProfileId,
            attestorProfileOverrides = {},
            ...licenseDetails
        } = config.license;

        const options = { ...managerOptions };
        if (Array.isArray(validators)) {
            options.validators = validators;
        }
        licenseManager = new LicenseManager(options);
        if (licenseDetails.key) {
            licenseManager.setLicense(licenseDetails);
        }

        if (autoValidate !== false && licenseDetails.key) {
            licenseManager.validate().catch(error => {
                console.warn('[AdaptiveSDK] License validation failed', error);
            });
        }

        if (attestor) {
            if (typeof attestor.createValidator === 'function') {
                licenseAttestor = attestor;
            } else {
                licenseAttestor = new RemoteLicenseAttestor(attestor);
            }
            licenseAttestorBindingOptions = attestorBinding || {};
        } else if (attestorProfileId) {
            pendingLicenseAttestorProfileId = attestorProfileId;
            pendingLicenseAttestorProfileOverrides = {
                ...pendingLicenseAttestorProfileOverrides,
                ...(attestorProfileOverrides || {})
            };
        }
    }

    if (licenseManager) {
        telemetryOptions.licenseManager = licenseManager;
        if (!telemetryOptions.licenseKey && licenseManager.getLicense()?.key) {
            telemetryOptions.licenseKey = licenseManager.getLicense().key;
        }
    }

    if (!licenseAttestor && config.licenseAttestor) {
        if (typeof config.licenseAttestor.createValidator === 'function') {
            licenseAttestor = config.licenseAttestor;
        } else {
            licenseAttestor = new RemoteLicenseAttestor(config.licenseAttestor);
        }
        licenseAttestorBindingOptions = config.licenseAttestorBinding || {};
    } else if (!licenseAttestor && config.licenseAttestorProfileId) {
        pendingLicenseAttestorProfileId = config.licenseAttestorProfileId;
        pendingLicenseAttestorProfileOverrides = {
            ...pendingLicenseAttestorProfileOverrides,
            ...(config.licenseAttestorProfileOverrides || {})
        };
    }

    if (licenseAttestor) {
        telemetryOptions.licenseAttestor = licenseAttestor;
        telemetryOptions.licenseAttestorBinding = licenseAttestorBindingOptions;
    }

    const engine = new AdaptiveInterfaceEngine({
        sensory: config.sensory,
        layout: config.layout,
        design: config.design,
        telemetry: telemetryOptions,
        marketplaceHooks: config.marketplaceHooks,
        projection: config.projection
    });

    if (licenseManager) {
        engine.telemetry.setLicenseManager(licenseManager);
    }

    if (licenseAttestor) {
        engine.telemetry.setLicenseAttestor(licenseAttestor, licenseAttestorBindingOptions);
    } else if (pendingLicenseAttestorProfileId) {
        const profileResult = engine.telemetry.setLicenseAttestorFromProfile(
            pendingLicenseAttestorProfileId,
            pendingLicenseAttestorProfileOverrides
        );
        if (profileResult?.attestor) {
            licenseAttestor = profileResult.attestor;
            licenseAttestorBindingOptions = profileResult.binding || {};
        }
    }

    if (Array.isArray(config.layoutStrategies)) {
        engine.layoutSynthesizer.clearStrategies();
        for (const strategy of config.layoutStrategies) {
            engine.registerLayoutStrategy(strategy);
        }
    }

    if (Array.isArray(config.layoutAnnotations)) {
        engine.layoutSynthesizer.clearAnnotations();
        for (const annotation of config.layoutAnnotations) {
            engine.registerLayoutAnnotation(annotation);
        }
    }

    if (Array.isArray(config.telemetryProviders)) {
        if (config.replaceDefaultProviders ?? false) {
            engine.telemetry.providers = new Map();
        }
        for (const provider of config.telemetryProviders) {
            engine.registerTelemetryProvider(provider);
        }
    }

    if (config.sensorSchemas) {
        if (Array.isArray(config.sensorSchemas)) {
            for (const entry of config.sensorSchemas) {
                if (entry && typeof entry === 'object' && entry.type && entry.schema) {
                    engine.registerSensorSchema(entry.type, entry.schema);
                }
            }
        } else if (typeof config.sensorSchemas === 'object') {
            for (const [type, schema] of Object.entries(config.sensorSchemas)) {
                engine.registerSensorSchema(type, schema);
            }
        }
    }

    if (Array.isArray(config.sensorAdapters)) {
        for (const adapter of config.sensorAdapters) {
            if (adapter && adapter.type && adapter.instance) {
                engine.registerSensorAdapter(adapter.type, adapter.instance, { autoConnect: adapter.autoConnect });
            }
        }
    }

    if (config.telemetryConsent) {
        engine.telemetry.updateConsent(config.telemetryConsent, { source: 'sdk-bootstrap' });
    }

    const defaultConsentOptions = Array.isArray(config.consentOptions) ? config.consentOptions : undefined;

    return {
        engine,
        sensoryBridge: engine.sensoryBridge,
        layoutSynthesizer: engine.layoutSynthesizer,
        telemetry: engine.telemetry,
        projectionComposer: engine.projectionComposer,
        projectionSimulator: engine.projectionSimulator,
        licenseManager,
        licenseAttestor,
        ShaderQuaternionSynchronizer,
        createShaderQuaternionSynchronizer(options = {}) {
            const { systems, systemResolver, ...rest } = options || {};
            const resolver = typeof systemResolver === 'function'
                ? systemResolver
                : (name => {
                    if (systems && systems[name]) {
                        return systems[name];
                    }
                    if (typeof engine?.getVisualSystem === 'function') {
                        const resolved = engine.getVisualSystem(name);
                        if (resolved) {
                            return resolved;
                        }
                    }
                    if (typeof window !== 'undefined' && window?.systemManager?.systems instanceof Map) {
                        return window.systemManager.systems.get(name) || null;
                    }
                    return null;
                });

            return new ShaderQuaternionSynchronizer({
                bridge: engine.sensoryBridge,
                systemResolver: resolver,
                ...rest
            });
        },
        registerLayoutStrategy: engine.registerLayoutStrategy.bind(engine),
        registerLayoutAnnotation: engine.registerLayoutAnnotation.bind(engine),
        registerTelemetryProvider: engine.registerTelemetryProvider.bind(engine),
        registerTelemetryRequestMiddleware: engine.registerTelemetryRequestMiddleware.bind(engine),
        clearTelemetryRequestMiddleware: engine.clearTelemetryRequestMiddleware.bind(engine),
        registerLicenseAttestationProfile: engine.registerLicenseAttestationProfile.bind(engine),
        registerLicenseAttestationProfilePack: engine.registerLicenseAttestationProfilePack.bind(engine),
        getLicenseAttestationProfiles: engine.telemetry.getLicenseAttestationProfiles.bind(engine.telemetry),
        getLicenseAttestationProfile: engine.telemetry.getLicenseAttestationProfile.bind(engine.telemetry),
        setDefaultLicenseAttestationProfile: engine.setDefaultLicenseAttestationProfile.bind(engine),
        setLicenseAttestorFromProfile(profileId, overrides = {}) {
            const result = engine.applyLicenseAttestationProfile(profileId, overrides);
            if (result?.attestor) {
                licenseAttestor = result.attestor;
                licenseAttestorBindingOptions = result.binding || {};
                this.licenseAttestor = licenseAttestor;
            }
            return result;
        },
        registerSensorSchema: engine.registerSensorSchema.bind(engine),
        registerSensorAdapter: engine.registerSensorAdapter.bind(engine),
        connectSensorAdapter: engine.connectSensorAdapter.bind(engine),
        disconnectSensorAdapter: engine.disconnectSensorAdapter.bind(engine),
        testSensorAdapter: engine.testSensorAdapter.bind(engine),
        updateTelemetryConsent: engine.telemetry.updateConsent.bind(engine.telemetry),
        getTelemetryConsent: engine.telemetry.getConsentSnapshot.bind(engine.telemetry),
        getTelemetryAuditTrail: engine.getTelemetryAuditTrail.bind(engine),
        getLicenseCommercializationSummary: engine.getLicenseCommercializationSummary.bind(engine),
        getLicenseCommercializationReporter: engine.getLicenseCommercializationReporter.bind(engine),
        getLicenseCommercializationSnapshotStore: engine.getLicenseCommercializationSnapshotStore.bind(engine),
        captureLicenseCommercializationSnapshot: engine.captureLicenseCommercializationSnapshot.bind(engine),
        getLicenseCommercializationSnapshots: engine.getLicenseCommercializationSnapshots.bind(engine),
        getLicenseCommercializationKpiReport: engine.getLicenseCommercializationKpiReport.bind(engine),
        exportLicenseCommercializationSnapshots: engine.exportLicenseCommercializationSnapshots.bind(engine),
        startLicenseCommercializationSnapshotSchedule: engine.startLicenseCommercializationSnapshotSchedule.bind(engine),
        stopLicenseCommercializationSnapshotSchedule: engine.stopLicenseCommercializationSnapshotSchedule.bind(engine),
        setLicense(license) {
            if (!licenseManager) {
                throw new Error('No license manager configured for this SDK instance.');
            }
            licenseManager.setLicense(license);
        },
        validateLicense(context) {
            if (!licenseManager) {
                throw new Error('No license manager configured for this SDK instance.');
            }
            return licenseManager.validate(context);
        },
        getLicenseStatus() {
            if (!licenseManager) {
                throw new Error('No license manager configured for this SDK instance.');
            }
            return licenseManager.getStatus();
        },
        getLicenseHistory() {
            if (!licenseManager) {
                throw new Error('No license manager configured for this SDK instance.');
            }
            return licenseManager.getValidationHistory();
        },
        getLicenseAttestationHistory() {
            if (!licenseAttestor || typeof licenseAttestor.getHistory !== 'function') {
                return [];
            }
            return licenseAttestor.getHistory();
        },
        composeProjectionField(blueprintOrLayout, design, context, options) {
            return engine.composeProjectionField(blueprintOrLayout, design, context, options);
        },
        getProjectionFrame() {
            return engine.getProjectionFrame();
        },
        stepProjectionSimulation(options) {
            return engine.stepProjectionSimulation(options);
        },
        registerProjectionScenario(descriptor) {
            return engine.registerProjectionScenario(descriptor);
        },
        registerProjectionScenarioPack(pack) {
            return engine.registerProjectionScenarioPack(pack);
        },
        removeProjectionScenario(id) {
            return engine.removeProjectionScenario(id);
        },
        listProjectionScenarios() {
            return engine.listProjectionScenarios();
        },
        listProjectionScenarioPacks() {
            return engine.listProjectionScenarioPacks();
        },
        getProjectionScenario(id) {
            return engine.getProjectionScenario(id);
        },
        getProjectionScenarioPack(id) {
            return engine.getProjectionScenarioPack(id);
        },
        setActiveProjectionScenario(id) {
            return engine.setActiveProjectionScenario(id);
        },
        getActiveProjectionScenario() {
            return engine.getActiveProjectionScenario();
        },
        getProjectionScenarioCatalog() {
            return engine.getProjectionScenarioCatalog();
        },
        setLicenseAttestor(attestor, options = {}) {
            if (attestor && typeof attestor.createValidator !== 'function' && typeof attestor.bindToLicenseManager !== 'function') {
                throw new Error('Invalid license attestor provided.');
            }
            if (attestor && typeof attestor.createValidator !== 'function') {
                attestor = new RemoteLicenseAttestor(attestor);
            }
            licenseAttestor = attestor;
            licenseAttestorBindingOptions = options;
            engine.telemetry.setLicenseAttestor(licenseAttestor, licenseAttestorBindingOptions);
            this.licenseAttestor = licenseAttestor;
        },
        requestLicenseAttestation(context = {}) {
            if (!licenseManager) {
                throw new Error('No license manager configured for this SDK instance.');
            }
            return licenseManager.validate({ ...context, trigger: 'manual-attestation' });
        },
        onLicenseStatusChange(listener) {
            if (!licenseManager || typeof licenseManager.onStatusChange !== 'function') {
                throw new Error('No license manager configured for this SDK instance.');
            }
            return licenseManager.onStatusChange(listener);
        },
        createConsentPanel(options = {}) {
            const consentOptions = options.consentOptions ?? defaultConsentOptions;
            return baseCreateConsentPanel({
                ...options,
                consentOptions
            });
        }
    };
}
