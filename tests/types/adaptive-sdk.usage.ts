import {
    createAdaptiveSDK,
    type AdaptiveSDKInstance,
    type TelemetryControls,
    type TelemetryProvider,
    type LicenseManagerStatus,
    type LocalizationSnapshot
} from 'vib34d-xr-quaternion-sdk';
import {
    createConsentExportBundle,
    createTelemetryFacade,
    createTelemetryProviderBlueprint,
    type TelemetryConsentExportOptions,
    type TelemetryFacadeOptions,
    type TelemetryProviderBlueprintInput
} from 'vib34d-xr-quaternion-sdk/product/telemetry/facade';
import {
    createReferenceTelemetryBlueprints,
    registerReferenceTelemetryProviders,
    type ReferenceTelemetryProviderRegistration
} from 'vib34d-xr-quaternion-sdk/product/telemetry/reference-providers';

const provider: TelemetryProvider = {
    id: 'console',
    track(event) {
        console.log(event.event, event.payload);
    }
};

const sdk: AdaptiveSDKInstance = createAdaptiveSDK({
    telemetry: {
        defaultConsent: { analytics: false },
        batch: {
            maxSize: 10,
            maxAgeMs: 1000,
            autoFlush: true
        }
    },
    telemetryProviders: [provider],
    consentOptions: [
        { classification: 'analytics', title: 'Analytics', description: 'Allow anonymized analytics events.' }
    ]
});

const status: LicenseManagerStatus = sdk.getLicenseStatus();
console.log('license state', status.state);

const controls: TelemetryControls = sdk.telemetryControls;
controls.track('custom.event', { source: 'types-check' });
controls.updateConsent({ analytics: true });
controls.flushBatches?.({ reason: 'types-usage' });
controls.getTelemetryBatcher?.()?.getMetrics();

const facadeOptions: TelemetryFacadeOptions = {
    harness: sdk.telemetry,
    owner: sdk.engine
};

createTelemetryFacade(facadeOptions);

const blueprintInput: TelemetryProviderBlueprintInput = {
    id: 'console',
    events: ['analytics.event'],
    retentionDays: 14
};
const blueprint = createTelemetryProviderBlueprint(blueprintInput);
console.log(blueprint.id, blueprint.retentionDays);

sdk.telemetryControls.createProviderBlueprint?.(blueprintInput);

const consentOptions: TelemetryConsentExportOptions = { format: 'json', revision: 2 };
const consentBundle = createConsentExportBundle(sdk.telemetry, consentOptions);
console.log(consentBundle.format);
sdk.telemetryControls.exportConsentBundle?.({ format: 'csv' });

const referenceCatalog = createReferenceTelemetryBlueprints();
const referenceRegistration: ReferenceTelemetryProviderRegistration = registerReferenceTelemetryProviders(sdk.telemetry, {
    consentBundle: false
});
console.log(referenceCatalog.console.id, referenceRegistration.providers.console.blueprint.description);

if (sdk.poseRegistry) {
    const device = sdk.poseRegistry.getDevice('headset-primary');
    console.log(device?.reliability);
}

sdk.createQuaternionPoseRegistrySynchronizer({
    registry: sdk.poseRegistry ?? new sdk.QuaternionPoseRegistry(),
    synchronizer: new sdk.ShaderQuaternionSynchronizer({ bridge: sdk.sensoryBridge, systems: {} }),
    minConfidence: 0.25,
});

const consensusModule = sdk.spatialConsensus ?? sdk.createSpatialConsensusModule();
const localizationSnapshot: LocalizationSnapshot = {
    id: 'anchor-primary',
    source: 'fabric',
    timestamp: Date.now(),
    frameId: 'frame-0',
    local: { real: [0, 0, 0, 1], dual: [0, 0, 0, 0] },
    global: null,
    confidence: 0.82,
    stageConfidence: 0.86,
    anchorConfidence: 0.88,
    drift: 0.12,
    reliability: 'high',
    latencyMs: 15,
    provenance: { anchorId: 'anchor-primary', referenceSpace: 'local-floor' },
    metrics: { accuracy: 0.91, rawConfidence: 0.85 }
};

const participant = consensusModule.ingest('participant-alpha', localizationSnapshot);
const consensus = consensusModule.getConsensus({ anchorId: 'anchor-primary', minParticipants: 1 });
console.log(participant.id, consensus?.anchorId);
