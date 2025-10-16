import type {
    ProductTelemetryHarness,
    TelemetryProviderBlueprint,
    ReferenceTelemetryBlueprintOptions,
    ReferenceTelemetryProviderOptions,
    ReferenceTelemetryProviderRegistration
} from '../../adaptive-sdk';

export {
    TelemetryProviderBlueprint,
    ReferenceTelemetryBlueprintOptions,
    ReferenceTelemetryProviderOptions,
    ReferenceTelemetryProviderRegistration
} from '../../adaptive-sdk';

export declare function createReferenceTelemetryBlueprints(
    options?: ReferenceTelemetryBlueprintOptions
): Record<string, TelemetryProviderBlueprint>;

export declare function registerReferenceTelemetryProviders(
    harness: ProductTelemetryHarness,
    options?: ReferenceTelemetryProviderOptions
): ReferenceTelemetryProviderRegistration;
