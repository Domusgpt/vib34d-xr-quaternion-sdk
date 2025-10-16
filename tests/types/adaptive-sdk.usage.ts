import {
    createAdaptiveSDK,
    type AdaptiveSDKInstance,
    type TelemetryControls,
    type TelemetryProvider,
    type LicenseManagerStatus
} from 'vib34d-xr-quaternion-sdk';
import {
    createConsentExportBundle,
    createTelemetryFacade,
    createTelemetryProviderBlueprint,
    type TelemetryConsentExportOptions,
    type TelemetryFacadeOptions,
    type TelemetryProviderBlueprintInput
} from 'vib34d-xr-quaternion-sdk/product/telemetry/facade';

const provider: TelemetryProvider = {
    id: 'console',
    track(event) {
        console.log(event.event, event.payload);
    }
};

const sdk: AdaptiveSDKInstance = createAdaptiveSDK({
    telemetry: {
        defaultConsent: { analytics: false }
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

if (sdk.poseRegistry) {
    const device = sdk.poseRegistry.getDevice('headset-primary');
    console.log(device?.reliability);
}

sdk.createQuaternionPoseRegistrySynchronizer({
    registry: sdk.poseRegistry ?? new sdk.QuaternionPoseRegistry(),
    synchronizer: new sdk.ShaderQuaternionSynchronizer({ bridge: sdk.sensoryBridge, systems: {} }),
    minConfidence: 0.25,
});
