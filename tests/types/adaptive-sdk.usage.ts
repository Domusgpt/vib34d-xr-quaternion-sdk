import {
    createAdaptiveSDK,
    type AdaptiveSDKInstance,
    type TelemetryControls,
    type TelemetryProvider,
    type LicenseManagerStatus
} from 'vib34d-xr-quaternion-sdk';
import { createTelemetryFacade, type TelemetryFacadeOptions } from 'vib34d-xr-quaternion-sdk/product/telemetry/facade';

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
