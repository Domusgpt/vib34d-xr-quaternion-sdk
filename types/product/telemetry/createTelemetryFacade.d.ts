import type {
    AdaptiveInterfaceEngine,
    ProductTelemetryHarness,
    TelemetryConsentExportBundle,
    TelemetryConsentExportOptions,
    TelemetryControls,
    TelemetryFacadeOptions,
    TelemetryHooks,
    TelemetryProviderBlueprint,
    TelemetryProviderBlueprintInput,
    ReferenceTelemetryBlueprintOptions,
    ReferenceTelemetryProviderOptions,
    ReferenceTelemetryProviderRegistration
} from '../../adaptive-sdk';

export {
    TelemetryConsentExportBundle,
    TelemetryConsentExportOptions,
    TelemetryControls,
    TelemetryFacadeOptions,
    TelemetryHooks,
    TelemetryProviderBlueprint,
    TelemetryProviderBlueprintInput,
    ReferenceTelemetryBlueprintOptions,
    ReferenceTelemetryProviderOptions,
    ReferenceTelemetryProviderRegistration
} from '../../adaptive-sdk';

export declare function createTelemetryFacade(options: TelemetryFacadeOptions): TelemetryControls;

export declare function applyTelemetryFacade(
    target: AdaptiveInterfaceEngine | ProductTelemetryHarness | unknown,
    options: TelemetryFacadeOptions & { owner?: AdaptiveInterfaceEngine | ProductTelemetryHarness | unknown }
): TelemetryControls;

export declare function createTelemetryProviderBlueprint(
    blueprint: TelemetryProviderBlueprintInput
): TelemetryProviderBlueprint;

export declare function createConsentExportBundle(
    harness: ProductTelemetryHarness,
    options?: TelemetryConsentExportOptions
): TelemetryConsentExportBundle;

export declare function createReferenceTelemetryBlueprints(
    options?: ReferenceTelemetryBlueprintOptions
): Record<string, TelemetryProviderBlueprint>;

export declare function registerReferenceTelemetryProviders(
    harness: ProductTelemetryHarness,
    options?: ReferenceTelemetryProviderOptions
): ReferenceTelemetryProviderRegistration;
