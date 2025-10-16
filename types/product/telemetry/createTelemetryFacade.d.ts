import type {
    AdaptiveInterfaceEngine,
    ProductTelemetryHarness,
    TelemetryControls,
    TelemetryFacadeOptions,
    TelemetryHooks
} from '../../adaptive-sdk';

export { TelemetryControls, TelemetryFacadeOptions, TelemetryHooks } from '../../adaptive-sdk';

export declare function createTelemetryFacade(options: TelemetryFacadeOptions): TelemetryControls;

export declare function applyTelemetryFacade(
    target: AdaptiveInterfaceEngine | ProductTelemetryHarness | unknown,
    options: TelemetryFacadeOptions & { owner?: AdaptiveInterfaceEngine | ProductTelemetryHarness | unknown }
): TelemetryControls;
