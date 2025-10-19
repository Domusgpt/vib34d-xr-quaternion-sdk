import { AdaptiveInterfaceEngine } from './AdaptiveInterfaceEngine.js';
import { createConsentPanel as baseCreateConsentPanel } from '../ui/components/ConsentPanel.js';
import { LicenseManager } from '../product/licensing/LicenseManager.js';
import { RemoteLicenseAttestor } from '../product/licensing/RemoteLicenseAttestor.js';
import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { QuaternionPoseRegistry } from '../core/quaternion/registry.ts';
import { QuaternionPoseRegistrySynchronizer } from '../ui/adaptive/renderers/QuaternionPoseRegistrySynchronizer.ts';
import { createTelemetryFacade } from '../product/telemetry/createTelemetryFacade.js';
import { PoseReliabilityMonitor } from '../ui/adaptive/renderers/PoseReliabilityMonitor.ts';
import { SpatialConsensusModule } from '../ui/adaptive/localization/SpatialConsensusModule.ts';

let poseFrameSequence = 0;

function nextPoseFrameId() {
    poseFrameSequence = (poseFrameSequence + 1) % 1000000;
    return `pose-frame-${Date.now().toString(16)}-${poseFrameSequence}`;
}

function resolvePoseTimestamp(candidate, fallback) {
    const timestamp = Number(candidate);
    if (Number.isFinite(timestamp) && timestamp >= 0) {
        return timestamp;
    }
    return fallback;
}

function normalizePoseSample(sample, timestamp, eventConfidence) {
    if (!sample || typeof sample !== 'object') {
        return null;
    }

    const orientation = sample.orientation || sample.quaternion;
    if (!orientation) {
        return null;
    }

    const position = sample.position || sample.translation || { x: 0, y: 0, z: 0 };
    const reliability = typeof sample.reliability === 'string' ? sample.reliability : 'estimated';
    const accuracy = Number.isFinite(sample.accuracy)
        ? Math.max(0, Math.min(1, sample.accuracy))
        : (Number.isFinite(eventConfidence) ? Math.max(0, Math.min(1, eventConfidence)) : 0.75);

    return {
        id: typeof sample.id === 'string' && sample.id ? sample.id : 'headset-primary',
        role: typeof sample.role === 'string' ? sample.role : 'headset',
        handedness: typeof sample.handedness === 'string' ? sample.handedness : 'none',
        timestamp,
        orientation,
        position,
        reliability,
        accuracy,
        linearVelocity: sample.linearVelocity || null,
        angularVelocity: sample.angularVelocity || null,
        buttons: Array.isArray(sample.buttons) ? sample.buttons : undefined,
        triggers: Array.isArray(sample.triggers) ? sample.triggers : undefined,
        joints: Array.isArray(sample.joints) ? sample.joints : undefined
    };
}

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

    let poseRegistry = null;
    let poseReliabilityMonitor = null;
    let spatialConsensus = null;
    const poseRegistryConfig = config.poseRegistryIngestors || config.poseRegistryIngestion || {};
    const ingestPoseFrames = poseRegistryConfig.poseFrame !== false;
    const ingestPoseSamples = poseRegistryConfig.pose !== false;
    const poseRegistrySubscriptions = [];

    if (config.poseRegistry && typeof config.poseRegistry.ingestFrame === 'function') {
        poseRegistry = config.poseRegistry;
    } else if (config.enablePoseRegistry !== false) {
        poseRegistry = new QuaternionPoseRegistry(config.poseRegistryOptions || {});
    }

    const poseReliabilityMonitorOptions = config.poseReliabilityMonitor;
    const poseReliabilityMonitorEnabled = config.enablePoseReliabilityMonitor !== false
        && poseReliabilityMonitorOptions !== false;

    const spatialConsensusOption = config.spatialConsensus;
    const spatialConsensusEnabled = config.enableSpatialConsensus !== false;
    if (spatialConsensusEnabled) {
        if (spatialConsensusOption instanceof SpatialConsensusModule) {
            spatialConsensus = spatialConsensusOption;
        } else {
            const consensusOptions = typeof spatialConsensusOption === 'object' && spatialConsensusOption
                ? { ...spatialConsensusOption }
                : {};
            if (typeof consensusOptions.timeSource !== 'function') {
                consensusOptions.timeSource = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now());
            }
            spatialConsensus = new SpatialConsensusModule(consensusOptions);
        }
    }

    const sensoryBridge = engine.sensoryBridge;

    const ingestFrame = frame => {
        if (!poseRegistry || !frame) {
            return;
        }

        try {
            poseRegistry.ingestFrame(frame);
        } catch (error) {
            console.warn('[AdaptiveSDK] Failed to ingest pose frame', error);
        }
    };

    if (poseRegistry && sensoryBridge && typeof sensoryBridge.subscribe === 'function') {
        if (ingestPoseFrames) {
            const unsubscribePoseFrame = sensoryBridge.subscribe('spatial.pose-frame', event => {
                const baseTimestamp = typeof event?.timestamp === 'number' ? event.timestamp : Date.now();
                const payload = event?.payload;
                if (!payload || typeof payload !== 'object') {
                    return;
                }

                const frameTimestamp = resolvePoseTimestamp(payload.timestamp, baseTimestamp);
                ingestFrame({
                    frameId: typeof payload.frameId === 'string' && payload.frameId
                        ? payload.frameId
                        : nextPoseFrameId(),
                    timestamp: frameTimestamp,
                    referenceSpace: typeof payload.referenceSpace === 'string'
                        ? payload.referenceSpace
                        : 'local',
                    head: payload.head,
                    controllers: Array.isArray(payload.controllers) ? payload.controllers : [],
                    hands: Array.isArray(payload.hands) ? payload.hands : [],
                    metadata: payload.metadata || undefined
                });
            });
            poseRegistrySubscriptions.push(unsubscribePoseFrame);
        }

        if (ingestPoseSamples) {
            const unsubscribePoseSample = sensoryBridge.subscribe('spatial.pose', event => {
                const baseTimestamp = typeof event?.timestamp === 'number' ? event.timestamp : Date.now();
                const pose = normalizePoseSample(event?.payload, baseTimestamp, event?.confidence);
                if (!pose) {
                    return;
                }

                ingestFrame({
                    frameId: nextPoseFrameId(),
                    timestamp: resolvePoseTimestamp(pose.timestamp, baseTimestamp),
                    referenceSpace: typeof event?.payload?.referenceSpace === 'string'
                        ? event.payload.referenceSpace
                        : 'local',
                    head: {
                        id: pose.id,
                        role: pose.role,
                        handedness: pose.handedness,
                        timestamp: resolvePoseTimestamp(pose.timestamp, baseTimestamp),
                        orientation: pose.orientation,
                        position: pose.position,
                        reliability: pose.reliability,
                        accuracy: pose.accuracy,
                        linearVelocity: pose.linearVelocity || undefined,
                        angularVelocity: pose.angularVelocity || undefined
                    },
                    controllers: [],
                    hands: []
                });
            });
            poseRegistrySubscriptions.push(unsubscribePoseSample);
        }
    }

    if (poseRegistry && poseReliabilityMonitorEnabled && engine?.telemetry) {
        const monitorConfig = typeof poseReliabilityMonitorOptions === 'object' && poseReliabilityMonitorOptions
            ? poseReliabilityMonitorOptions
            : {};

        poseReliabilityMonitor = new PoseReliabilityMonitor({
            registry: poseRegistry,
            telemetry: engine.telemetry,
            updateIntervalMs: monitorConfig.updateIntervalMs,
            staleThresholdMs: monitorConfig.staleThresholdMs,
            degradedConfidenceThreshold: monitorConfig.degradedConfidenceThreshold,
            recoveredConfidenceThreshold: monitorConfig.recoveredConfidenceThreshold,
            roleFilter: monitorConfig.roleFilter,
            deviceFilter: monitorConfig.deviceFilter,
            includeRecoveredEvents: monitorConfig.includeRecoveredEvents,
            autoStart: monitorConfig.autoStart,
            now: monitorConfig.now,
            onStateChange: monitorConfig.onStateChange
        });
    }

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

    const telemetryFacade = engine.telemetryFacade || createTelemetryFacade({
        harness: engine.telemetry,
        owner: engine,
        hooks: {
            onProviderRegistered: provider => {
                if (provider?.id) {
                    engine.telemetry.track('design.telemetry.provider_registered', { id: provider.id });
                }
            },
            onProviderRemoved: id => {
                if (id) {
                    engine.telemetry.track('design.telemetry.provider_removed', { id });
                }
            }
        }
    });

    const createShaderSynchronizer = function createShaderSynchronizer(options = {}) {
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
            bridge: sensoryBridge,
            systemResolver: resolver,
            ...rest
        });
    };

    const createPoseRegistrySynchronizer = function createPoseRegistrySynchronizer(options = {}) {
        const { registry: explicitRegistry, synchronizer, synchronizerOptions, ...rest } = options || {};
        const activeRegistry = explicitRegistry || poseRegistry;
        if (!activeRegistry) {
            throw new Error('No QuaternionPoseRegistry configured. Pass a registry explicitly or enable the default instance.');
        }

        const activeSynchronizer = synchronizer
            || (synchronizerOptions
                ? new ShaderQuaternionSynchronizer({
                    bridge: sensoryBridge,
                    ...synchronizerOptions
                })
                : createShaderSynchronizer());

        return new QuaternionPoseRegistrySynchronizer({
            registry: activeRegistry,
            synchronizer: activeSynchronizer,
            ...rest
        });
    };

    return {
        engine,
        sensoryBridge,
        layoutSynthesizer: engine.layoutSynthesizer,
        telemetry: engine.telemetry,
        telemetryControls: telemetryFacade,
        projectionComposer: engine.projectionComposer,
        projectionSimulator: engine.projectionSimulator,
        licenseManager,
        licenseAttestor,
        ShaderQuaternionSynchronizer,
        QuaternionPoseRegistry,
        QuaternionPoseRegistrySynchronizer,
        poseRegistry,
        poseReliabilityMonitor,
        spatialConsensus,
        createShaderQuaternionSynchronizer(options = {}) {
            return createShaderSynchronizer(options);
        },
        createQuaternionPoseRegistrySynchronizer(options = {}) {
            return createPoseRegistrySynchronizer(options);
        },
        createSpatialConsensusModule(options = {}) {
            const consensusOptions = { ...options };
            if (typeof consensusOptions.timeSource !== 'function') {
                consensusOptions.timeSource = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now());
            }
            return new SpatialConsensusModule(consensusOptions);
        },
        registerLayoutStrategy: engine.registerLayoutStrategy.bind(engine),
        registerLayoutAnnotation: engine.registerLayoutAnnotation.bind(engine),
        registerTelemetryProvider: telemetryFacade.registerProvider,
        registerTelemetryRequestMiddleware: telemetryFacade.registerRequestMiddleware,
        clearTelemetryRequestMiddleware: telemetryFacade.clearRequestMiddleware,
        registerLicenseAttestationProfile: telemetryFacade.registerLicenseAttestationProfile,
        registerLicenseAttestationProfilePack: telemetryFacade.registerLicenseAttestationProfilePack,
        getLicenseAttestationProfiles: telemetryFacade.getLicenseAttestationProfiles,
        getLicenseAttestationProfile: telemetryFacade.getLicenseAttestationProfile,
        setDefaultLicenseAttestationProfile: telemetryFacade.setDefaultLicenseAttestationProfile,
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
        getTelemetryAuditTrail: telemetryFacade.getAuditTrail,
        getLicenseCommercializationSummary: telemetryFacade.getCommercializationSummary,
        getLicenseCommercializationReporter: telemetryFacade.getCommercializationReporter,
        getLicenseCommercializationSnapshotStore: telemetryFacade.getCommercializationSnapshotStore,
        captureLicenseCommercializationSnapshot: telemetryFacade.captureCommercializationSnapshot,
        getLicenseCommercializationSnapshots: telemetryFacade.getCommercializationSnapshots,
        getLicenseCommercializationKpiReport: telemetryFacade.getCommercializationKpiReport,
        exportLicenseCommercializationSnapshots: telemetryFacade.exportCommercializationSnapshots,
        startLicenseCommercializationSnapshotSchedule: telemetryFacade.startCommercializationSnapshotSchedule,
        stopLicenseCommercializationSnapshotSchedule: telemetryFacade.stopCommercializationSnapshotSchedule,
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
        },
        dispose() {
            while (poseRegistrySubscriptions.length > 0) {
                try {
                    poseRegistrySubscriptions.pop()?.();
                } catch (error) {
                    console.warn('[AdaptiveSDK] Failed to remove pose registry subscription', error);
                }
            }
            poseReliabilityMonitor?.dispose?.();
            engine.dispose?.();
        }
    };
}
