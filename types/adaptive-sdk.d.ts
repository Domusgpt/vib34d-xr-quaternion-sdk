/**
 * Adaptive SDK Type Definitions
 * ---------------------------------------------
 * These declarations capture the public surface of the VIB34D XR Quaternion
 * SDK so TypeScript partners can integrate against the documented runtime
 * boundary without relying on ambient "any" types.
 */

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonObject
    | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export interface JsonArray extends Array<JsonValue> {}

export interface ConsentOption {
    /** Unique consent classification handled by the telemetry harness. */
    classification: string;
    /** Friendly title exposed to end-users. */
    title: string;
    /** Optional descriptive copy rendered alongside the toggle. */
    description?: string;
}

export interface ConsentPanelOptions {
    /** DOM element that will host the consent experience. */
    container: HTMLElement;
    /** Consent toggles rendered into the panel. */
    consentOptions?: ConsentOption[];
    /** Snapshot provider wired to `ProductTelemetryHarness.getConsentSnapshot`. */
    getTelemetryConsent?: () => TelemetryConsentSnapshot | TelemetryConsentMap;
    /** Callback invoked whenever a consent toggle is updated. */
    onConsentToggle?: (classification: string, enabled: boolean) => void;
    /** Hook delivering compliance/audit records for display and downloads. */
    getComplianceRecords?: () => TelemetryAuditEntry[];
    /** Optional accessor for telemetry audit trails. */
    getTelemetryAuditTrail?: () => TelemetryAuditEntry[];
    /** Interval, in milliseconds, used when refreshing the compliance log. */
    refreshInterval?: number;
    /** Formatter used when exporting audit/compliance history. */
    downloadFormatter?: (records: TelemetryAuditEntry[]) => string;
    /** Prefix applied to generated download file names. */
    downloadFileNamePrefix?: string;
    /** Interceptor invoked before exporting compliance records. */
    onDownload?: (payload: { records: TelemetryAuditEntry[]; payload: string }) => void;
    /** Lifecycle hook triggered after consent state renders. */
    onRender?: (context: { consent: TelemetryConsentSnapshot | TelemetryConsentMap; metadata?: JsonObject }) => void;
    /** Telemetry hook automatically fired whenever a toggle flips. */
    trackConsentToggle?: (classification: string, enabled: boolean) => void;
    /** Factory used to create the temporary download anchor element. */
    createAnchor?: () => HTMLAnchorElement;
    /** Heading label rendered above the consent grid. */
    heading?: string;
}

export interface ConsentPanelInstance {
    /** Mounts the panel into the configured container. */
    mount(): ConsentPanelInstance;
    /** Tears down listeners and timers. */
    destroy(): void;
    /** Forces the compliance log to refresh immediately. */
    refreshComplianceLog(): void;
    /** Synchronises the UI when consent snapshots are updated externally. */
    handleConsentDecision(consent: TelemetryConsentSnapshot | TelemetryConsentMap, metadata?: JsonObject): void;
}

export type TelemetryConsentMap = Record<string, boolean>;

export interface TelemetryConsentSnapshot extends TelemetryConsentMap {
    /** ISO timestamp representing the last update. */
    updatedAt?: string;
    /** Optional metadata describing the consent origin. */
    metadata?: JsonObject;
}

export interface TelemetryAuditEntry {
    event: string;
    classification?: string;
    source?: string;
    payload?: JsonObject;
    timestamp: string | number | Date;
}

export interface TelemetryEvent {
    event: string;
    payload?: JsonObject;
    classification?: string;
    timestamp?: string | number | Date;
    source?: string;
    licenseKey?: string | null;
    [key: string]: unknown;
}

export type TelemetryRequestMiddleware = (
    event: TelemetryEvent,
    next: () => Promise<void>
) => Promise<void> | void;

export interface TelemetryProvider {
    id: string;
    start?(): void | Promise<void>;
    stop?(): void | Promise<void>;
    flush?(): void | Promise<void>;
    track?(event: TelemetryEvent): void | Promise<void>;
    identify?(identity: JsonObject, traits?: JsonObject): void | Promise<void>;
    registerRequestMiddleware?(middleware: TelemetryRequestMiddleware): void;
    clearRequestMiddleware?(): void;
    [key: string]: unknown;
}

export interface LicensePayload {
    key: string;
    tenantId?: string | null;
    features?: string[];
    expiresAt?: string | Date | null;
    issuedAt?: string | Date | null;
    signature?: string | null;
    metadata?: JsonObject;
}

export interface LicenseManagerStatus {
    state: 'unregistered' | 'pending' | 'valid' | 'invalid' | 'expired' | string;
    reason?: string;
    validatedAt?: string | null;
    metadata?: JsonObject;
    error?: string;
}

export interface LicenseManagerOptions {
    validators?: Array<(license: LicensePayload, context: JsonObject) => unknown | Promise<unknown>>;
    clock?: () => Date | number;
    logger?: Console;
}

export class LicenseManager {
    constructor(options?: LicenseManagerOptions);
    onStatusChange(listener: (status: LicenseManagerStatus) => void): () => void;
    getLicense(): LicensePayload | null;
    setLicense(license: LicensePayload | null): LicenseManagerStatus;
    clearLicense(): LicenseManagerStatus;
    registerValidator(validator: (license: LicensePayload, context: JsonObject) => unknown | Promise<unknown>): () => void;
    validate(context?: JsonObject): Promise<LicenseManagerStatus>;
    getStatus(): LicenseManagerStatus;
    getValidationHistory(): LicenseManagerStatus[];
}

export interface LicenseAttestor {
    createValidator(context?: JsonObject):
        | ((license: LicensePayload, context?: JsonObject) => Promise<boolean | JsonObject> | boolean | JsonObject)
        | Promise<(license: LicensePayload, context?: JsonObject) => Promise<boolean | JsonObject> | boolean | JsonObject>;
    bindToLicenseManager?(manager: LicenseManager, options?: JsonObject): () => void;
    on?(event: string, listener: (payload: unknown) => void): () => void;
    off?(event: string, listener: (payload: unknown) => void): void;
    detach?(): void;
    getHistory?(): Array<{ timestamp: string; entry: unknown }> | unknown[];
}

export interface RemoteLicenseAttestorOptions {
    attestationUrl?: string | null;
    revocationUrl?: string | null;
    entitlementsUrl?: string | null;
    fetch?: typeof fetch;
    logger?: Console;
    clock?: () => Date | number;
    pollIntervalMs?: number;
    minimumPollIntervalMs?: number;
    failOpen?: boolean;
    headers?: Record<string, string>;
    transformRequest?: (request: JsonObject & { url?: string }) => JsonObject;
    transformResponse?: (response: unknown) => unknown;
    historyLimit?: number;
}

export class RemoteLicenseAttestor implements LicenseAttestor {
    constructor(options?: RemoteLicenseAttestorOptions);
    createValidator(
        context?: JsonObject
    ): (license: LicensePayload, context?: JsonObject) => Promise<boolean | JsonObject> | boolean | JsonObject;
    bindToLicenseManager(manager: LicenseManager, options?: JsonObject): () => void;
    detach(): void;
    getHistory(): Array<{ timestamp: string; entry: unknown }>;
    on(event: string, listener: (payload: unknown) => void): () => void;
    off(event: string, listener: (payload: unknown) => void): void;
}

export interface LicenseAttestationProfile {
    id: string;
    name?: string;
    sla?: string;
    metadata?: JsonObject;
    description?: string;
    [key: string]: unknown;
}

export interface LicenseAttestationProfilePack {
    id: string;
    profiles: LicenseAttestationProfile[];
    defaultProfileId?: string | null;
    metadata?: JsonObject;
}

export interface LicenseAttestationProfilePackOptions {
    applyDefault?: boolean;
    [key: string]: unknown;
}

export interface LicenseAttestorBindingResult {
    attestor: LicenseAttestor | null;
    binding?: JsonObject;
    profile?: LicenseAttestationProfile | null;
}

export interface CommercializationSnapshotQuery {
    limit?: number;
    since?: string | Date;
    until?: string | Date;
    filter?: JsonObject;
}

export interface LicenseCommercializationSnapshot {
    id: string;
    capturedAt: string;
    metrics: JsonObject;
    context?: JsonObject;
}

export interface LicenseCommercializationSummary {
    totalProfiles?: number;
    activeProfiles?: number;
    lastSnapshotAt?: string | null;
    [key: string]: unknown;
}

export interface CommercializationSnapshotExportOptions {
    format?: 'json' | 'csv' | string;
    fields?: string[];
    filter?: JsonObject;
    filename?: string;
}

export interface CommercializationSnapshotExportResult {
    format: string;
    payload: string | Blob | ArrayBufferLike | JsonObject;
    filename?: string;
}

export interface CommercializationKpiQuery {
    window?: 'daily' | 'weekly' | 'monthly' | string;
    filter?: JsonObject;
}

export interface LicenseCommercializationKpiReport {
    window: string;
    metrics: JsonObject;
    generatedAt: string;
    [key: string]: unknown;
}

export interface LicenseCommercializationReporter {
    addUpdateListener(listener: (summary: LicenseCommercializationSummary) => void): () => void;
    getPackIdForProfile(profileId: string): string | null | undefined;
    recordProfileRegistration(profile: LicenseAttestationProfile, context?: JsonObject): void;
    recordSnapshot?(snapshot: LicenseCommercializationSnapshot, context?: JsonObject): void;
    [key: string]: unknown;
}

export interface LicenseCommercializationSnapshotStore {
    recordSnapshot(summary: LicenseCommercializationSummary, context?: JsonObject): void;
    getSnapshots(options?: CommercializationSnapshotQuery): LicenseCommercializationSnapshot[];
    exportSnapshots?(options?: CommercializationSnapshotExportOptions):
        | CommercializationSnapshotExportResult
        | Promise<CommercializationSnapshotExportResult>;
    whenReady?(): Promise<void>;
    [key: string]: unknown;
}

export interface TelemetryControls {
    track(event: string, payload?: JsonObject, options?: JsonObject): void;
    identify(identity: JsonObject, traits?: JsonObject): void;
    flush(): Promise<void> | void;
    start(): void;
    stop(): void;
    updateConsent(consent: TelemetryConsentMap, context?: JsonObject): void;
    getConsentSnapshot(): TelemetryConsentSnapshot;
    recordAudit(event: string, payload?: JsonObject, classification?: string): void;
    recordSchemaIssue(issue: JsonObject): void;
    setConsentDecisionHandler(handler: ((classification: string, allow: boolean) => void) | null): void;
    registerProvider(provider: TelemetryProvider): AdaptiveInterfaceEngine;
    removeProvider(id: string): AdaptiveInterfaceEngine;
    registerRequestMiddleware(middleware: TelemetryRequestMiddleware): AdaptiveInterfaceEngine;
    clearRequestMiddleware(): AdaptiveInterfaceEngine;
    registerLicenseAttestationProfile(
        profileOrId: string | LicenseAttestationProfile,
        profile?: LicenseAttestationProfile
    ): LicenseAttestationProfile;
    registerLicenseAttestationProfilePack(
        packOrId: string | LicenseAttestationProfilePack,
        options?: LicenseAttestationProfilePackOptions
    ): LicenseAttestationProfilePack;
    getLicenseAttestationProfiles(): LicenseAttestationProfile[];
    getLicenseAttestationProfile(id: string): LicenseAttestationProfile | undefined;
    setDefaultLicenseAttestationProfile(id: string | null): AdaptiveInterfaceEngine;
    setLicenseAttestorFromProfile(id: string, overrides?: JsonObject): LicenseAttestorBindingResult | undefined;
    setLicenseManager(manager: LicenseManager): AdaptiveInterfaceEngine;
    setLicenseAttestor(attestor: LicenseAttestor, options?: JsonObject): AdaptiveInterfaceEngine;
    getAuditTrail(): TelemetryAuditEntry[];
    getCommercializationSummary(): LicenseCommercializationSummary | null;
    getCommercializationReporter(): LicenseCommercializationReporter | null;
    getCommercializationSnapshotStore(): LicenseCommercializationSnapshotStore | null;
    captureCommercializationSnapshot(context?: JsonObject): LicenseCommercializationSnapshot | null;
    getCommercializationSnapshots(options?: CommercializationSnapshotQuery): LicenseCommercializationSnapshot[];
    getCommercializationKpiReport(options?: CommercializationKpiQuery): LicenseCommercializationKpiReport;
    exportCommercializationSnapshots(
        options?: CommercializationSnapshotExportOptions
    ): CommercializationSnapshotExportResult | Promise<CommercializationSnapshotExportResult>;
    startCommercializationSnapshotSchedule(intervalMs: number, context?: JsonObject): unknown;
    stopCommercializationSnapshotSchedule(): AdaptiveInterfaceEngine;
}

export interface SensoryBridgeSubscription {
    unsubscribe(): void;
}

export interface SensoryInputBridge {
    start(): void;
    stop(): void;
    subscribe(channel: string, handler: (payload: unknown) => void): () => void | SensoryBridgeSubscription;
    registerSchema(type: string, schema: JsonObject): void;
    registerAdapter(type: string, adapter: SensorAdapter): void;
    connectAdapter?(type: string): Promise<void>;
    disconnectAdapter?(type: string): Promise<void>;
    testAdapter?(type: string): Promise<void>;
    setValidationReporter?(reporter: (issue: JsonObject) => void): void;
    [key: string]: unknown;
}

export interface SensorAdapter {
    connect?(): Promise<void> | void;
    disconnect?(): Promise<void> | void;
    test?(): Promise<void> | void;
    [key: string]: unknown;
}

export interface SensorAdapterRegistration {
    type: string;
    instance: SensorAdapter;
    autoConnect?: boolean;
}

export interface SensorSchemaRegistration {
    type: string;
    schema: JsonObject;
}

export interface SpatialLayoutSynthesizer {
    registerStrategy(strategy: LayoutStrategy): SpatialLayoutSynthesizer;
    clearStrategies(): void;
    registerAnnotation(annotation: LayoutAnnotation): SpatialLayoutSynthesizer;
    clearAnnotations(): void;
    [key: string]: unknown;
}

export interface LayoutStrategy {
    id: string;
    description?: string;
    execute?(context: JsonObject): unknown;
    [key: string]: unknown;
}

export interface LayoutAnnotation {
    id: string;
    description?: string;
    apply?(layout: unknown, context?: JsonObject): unknown;
    [key: string]: unknown;
}

export interface ProjectionFieldComposer {
    compose(blueprintOrLayout: unknown, design?: unknown, context?: unknown, options?: JsonObject): unknown;
    [key: string]: unknown;
}

export interface ProjectionScenarioDescriptor extends JsonObject {
    id: string;
}

export interface ProjectionScenarioCatalog {
    applyToSimulator?(simulator: ProjectionScenarioSimulator): void;
    list(): ProjectionScenarioDescriptor[];
    get(id: string): ProjectionScenarioDescriptor | undefined;
    register(descriptor: ProjectionScenarioDescriptor): string | ProjectionScenarioDescriptor;
    registerPack?(pack: ProjectionScenarioDescriptor | ProjectionScenarioDescriptor[]): unknown;
    remove(id: string): boolean;
}

export interface ProjectionScenarioSimulator {
    step(options?: JsonObject): unknown;
    setActiveScenario(id: string): void;
    getActiveScenario(): ProjectionScenarioDescriptor | null;
    [key: string]: unknown;
}

export interface ShaderQuaternionSynchronizerOptions {
    bridge: SensoryInputBridge;
    systems?: Record<string, unknown>;
    systemResolver?: (name: string) => unknown;
    rotationScale?: number;
    minConfidence?: number;
    baseAlpha?: number;
    energySmoothing?: number;
    velocityReference?: number;
    logger?: Console;
    targetSystems?: string[];
    autoExclusiveActivation?: boolean;
    maxActiveSystems?: number;
    activationEventTarget?: EventTarget | null;
    activationEvent?: string;
    deactivationEvent?: string;
}

export class ShaderQuaternionSynchronizer {
    constructor(options: ShaderQuaternionSynchronizerOptions);
    start(): void;
    stop(): void;
    dispose(): void;
    setTargetSystems(systems: Iterable<string>): void;
    activateExclusiveSystem(systemName: string): void;
    syncBaseParameters(parameters: Record<string, number>): void;
}

export interface QuaternionPoseRegistrySynchronizerOptions {
    registry: unknown;
    shaderSynchronizer: ShaderQuaternionSynchronizer;
    pollIntervalMs?: number | false;
    reliabilityWeights?: Record<string, number>;
    devicePreference?: string[];
}

export class QuaternionPoseRegistrySynchronizer {
    constructor(options: QuaternionPoseRegistrySynchronizerOptions);
    start(): void;
    stop(): void;
    dispose(): void;
}

export interface AdaptiveInterfaceEngine {
    sensoryBridge: SensoryInputBridge;
    layoutSynthesizer: SpatialLayoutSynthesizer;
    telemetry: ProductTelemetryHarness;
    telemetryFacade: TelemetryControls;
    projectionComposer: ProjectionFieldComposer;
    projectionSimulator: ProjectionScenarioSimulator;
    projectionCatalog?: ProjectionScenarioCatalog;
    marketplaceHooks?: JsonObject;
    registerLayoutStrategy(strategy: LayoutStrategy): AdaptiveInterfaceEngine;
    registerLayoutAnnotation(annotation: LayoutAnnotation): AdaptiveInterfaceEngine;
    registerSensorSchema(type: string, schema: JsonObject): AdaptiveInterfaceEngine;
    registerSensorAdapter(type: string, adapter: SensorAdapter): AdaptiveInterfaceEngine;
    connectSensorAdapter(type: string): Promise<void>;
    disconnectSensorAdapter(type: string): Promise<void>;
    testSensorAdapter(type: string): Promise<void>;
    getVisualSystem?(name: string): unknown;
    composeProjectionField(
        blueprintOrLayout: unknown,
        design?: unknown,
        context?: unknown,
        options?: JsonObject
    ): unknown;
    getProjectionFrame(): unknown;
    stepProjectionSimulation(options?: JsonObject): unknown;
    registerProjectionScenario(descriptor: ProjectionScenarioDescriptor): string | ProjectionScenarioDescriptor;
    registerProjectionScenarioPack(pack: ProjectionScenarioDescriptor | ProjectionScenarioDescriptor[]): unknown;
    removeProjectionScenario(id: string): boolean;
    listProjectionScenarios(): ProjectionScenarioDescriptor[];
    listProjectionScenarioPacks(): ProjectionScenarioDescriptor[];
    getProjectionScenario(id: string): ProjectionScenarioDescriptor | undefined;
    getProjectionScenarioPack(id: string): ProjectionScenarioDescriptor | undefined;
    setActiveProjectionScenario(id: string): void;
    getActiveProjectionScenario(): ProjectionScenarioDescriptor | null;
    getProjectionScenarioCatalog(): ProjectionScenarioCatalog;
    applyLicenseAttestationProfile(id: string, overrides?: JsonObject): LicenseAttestorBindingResult;
}

export interface ProductTelemetryHarness {
    start(): void;
    stop(): void;
    track(event: string, payload?: JsonObject, options?: JsonObject): void;
    identify(identity: JsonObject, traits?: JsonObject): void;
    updateConsent(consent: TelemetryConsentMap, context?: JsonObject): void;
    getConsentSnapshot(): TelemetryConsentSnapshot;
    recordAudit(event: string, payload?: JsonObject, classification?: string): void;
    recordSchemaIssue(issue: JsonObject): void;
    setConsentDecisionHandler(handler: ((classification: string, allow: boolean) => void) | null): void;
    registerProvider(provider: TelemetryProvider): void;
    removeProvider(id: string): void;
    registerRequestMiddleware(middleware: TelemetryRequestMiddleware): void;
    clearRequestMiddleware(): void;
    registerLicenseAttestationProfile(
        profileOrId: string | LicenseAttestationProfile,
        profile?: LicenseAttestationProfile
    ): LicenseAttestationProfile;
    registerLicenseAttestationProfilePack(
        packOrId: string | LicenseAttestationProfilePack,
        options?: LicenseAttestationProfilePackOptions
    ): LicenseAttestationProfilePack;
    getLicenseAttestationProfiles(): LicenseAttestationProfile[];
    getLicenseAttestationProfile(id: string): LicenseAttestationProfile | undefined;
    setDefaultLicenseAttestationProfile(id: string | null): void;
    setLicenseAttestor(attestor: LicenseAttestor, options?: JsonObject): void;
    setLicenseAttestorFromProfile(id: string, overrides?: JsonObject): LicenseAttestorBindingResult | undefined;
    getAuditTrail(): TelemetryAuditEntry[];
    getCommercializationSummary(): LicenseCommercializationSummary | null;
    getCommercializationReporter(): LicenseCommercializationReporter | null;
    getCommercializationSnapshotStore(): LicenseCommercializationSnapshotStore | null;
    captureCommercializationSnapshot(context?: JsonObject): LicenseCommercializationSnapshot | null;
    getCommercializationSnapshots(options?: CommercializationSnapshotQuery): LicenseCommercializationSnapshot[];
    getCommercializationKpiReport(options?: CommercializationKpiQuery): LicenseCommercializationKpiReport;
    exportCommercializationSnapshots(
        options?: CommercializationSnapshotExportOptions
    ): CommercializationSnapshotExportResult | Promise<CommercializationSnapshotExportResult>;
    startCommercializationSnapshotSchedule(intervalMs: number, context?: JsonObject): unknown;
    stopCommercializationSnapshotSchedule(): void;
    setLicenseManager(manager: LicenseManager): void;
    setLicenseAttestor(attestor: LicenseAttestor, options?: JsonObject): void;
    getLicenseAttestor?(): LicenseAttestor | null;
}

export interface TelemetryHooks {
    onProviderRegistered?(provider: TelemetryProvider, result?: unknown): void;
    onProviderRemoved?(id: string, result?: unknown): void;
    onRequestMiddlewareCleared?(result?: unknown): void;
    onDefaultAttestationProfileChanged?(id: string | null): void;
    onCommercializationScheduleStarted?(intervalMs: number, context?: JsonObject, handle?: unknown): void;
    onCommercializationScheduleStopped?(result?: unknown): void;
}

export interface TelemetryFacadeOptions {
    harness: ProductTelemetryHarness;
    owner?: AdaptiveInterfaceEngine | ProductTelemetryHarness | unknown;
    hooks?: TelemetryHooks;
}

export interface AdaptiveSDKLicenseConfig extends LicenseBootstrapOptions {
    /** Existing license manager to reuse instead of instantiating a new one. */
    managerOptions?: LicenseManagerOptions;
}

export interface LicenseBootstrapOptions extends LicensePayload {
    validators?: Array<(license: LicensePayload, context: JsonObject) => unknown | Promise<unknown>>;
    autoValidate?: boolean;
    managerOptions?: LicenseManagerOptions;
    attestor?: LicenseAttestor | RemoteLicenseAttestorOptions;
    attestorBinding?: JsonObject;
    attestorProfileId?: string;
    attestorProfileOverrides?: JsonObject;
}

export interface AdaptiveSDKProjectionConfig {
    composer?: JsonObject;
    simulator?: JsonObject;
    catalog?: ProjectionScenarioCatalog | JsonObject;
}

export interface AdaptiveSDKConfig {
    sensory?: JsonObject;
    layout?: JsonObject;
    design?: JsonObject;
    projection?: AdaptiveSDKProjectionConfig;
    telemetry?: JsonObject;
    marketplaceHooks?: JsonObject;
    projectionComposer?: JsonObject;
    layoutStrategies?: LayoutStrategy[];
    layoutAnnotations?: LayoutAnnotation[];
    sensorSchemas?: SensorSchemaRegistration[] | Record<string, JsonObject>;
    sensorAdapters?: SensorAdapterRegistration[];
    telemetryProviders?: TelemetryProvider[];
    telemetryConsent?: TelemetryConsentMap;
    consentOptions?: ConsentOption[];
    replaceDefaultProviders?: boolean;
    licenseManager?: LicenseManager;
    license?: LicenseBootstrapOptions;
    licenseAttestor?: LicenseAttestor | RemoteLicenseAttestorOptions;
    licenseAttestorBinding?: JsonObject;
    licenseAttestorProfileId?: string;
    licenseAttestorProfileOverrides?: JsonObject;
    licenseAttestationProfilePacks?: Array<string | LicenseAttestationProfilePack>;
    licenseAttestationProfilePackId?: string;
    licenseAttestationProfilePackOptions?: JsonObject;
    licenseAttestationProfiles?: LicenseAttestationProfile[];
    defaultLicenseAttestationProfileId?: string;
    commercialization?: JsonObject;
    commercializationReporter?: LicenseCommercializationReporter;
    systems?: Record<string, unknown>;
    systemResolver?: (name: string) => unknown;
}

export interface AdaptiveSDKInstance {
    /** Underlying adaptive engine wiring sensors, layout, telemetry, and projection systems. */
    engine: AdaptiveInterfaceEngine;
    /** Convenience alias for `engine.sensoryBridge`. */
    sensoryBridge: SensoryInputBridge;
    /** Convenience alias for `engine.layoutSynthesizer`. */
    layoutSynthesizer: SpatialLayoutSynthesizer;
    /** Product telemetry harness backing the facade/controls. */
    telemetry: ProductTelemetryHarness;
    /** High-level telemetry facade with helper ergonomics. */
    telemetryControls: TelemetryControls;
    /** Projection composer used for holographic/polychora layouts. */
    projectionComposer: ProjectionFieldComposer;
    /** Scenario simulator used for what-if projection modelling. */
    projectionSimulator: ProjectionScenarioSimulator;
    /** Optional license manager if configured at bootstrap. */
    licenseManager: LicenseManager | null;
    /** Optional license attestor in use by the telemetry harness. */
    licenseAttestor: LicenseAttestor | null;
    /** Raw synchronizer constructor for advanced consumers. */
    ShaderQuaternionSynchronizer: typeof ShaderQuaternionSynchronizer;
    /**
     * Factory for quaternion synchronizers that respects the engine's registered
     * visual systems plus any explicit overrides provided at call time.
     */
    createShaderQuaternionSynchronizer(
        options?: ShaderQuaternionSynchronizerOptions & {
            systems?: Record<string, unknown>;
            systemResolver?: (name: string) => unknown;
        }
    ): ShaderQuaternionSynchronizer;
    registerLayoutStrategy(strategy: LayoutStrategy): AdaptiveInterfaceEngine;
    registerLayoutAnnotation(annotation: LayoutAnnotation): AdaptiveInterfaceEngine;
    registerTelemetryProvider(provider: TelemetryProvider): AdaptiveInterfaceEngine;
    registerTelemetryRequestMiddleware(middleware: TelemetryRequestMiddleware): AdaptiveInterfaceEngine;
    clearTelemetryRequestMiddleware(): AdaptiveInterfaceEngine;
    registerLicenseAttestationProfile(
        profileOrId: string | LicenseAttestationProfile,
        profile?: LicenseAttestationProfile
    ): LicenseAttestationProfile;
    registerLicenseAttestationProfilePack(
        packOrId: string | LicenseAttestationProfilePack,
        options?: LicenseAttestationProfilePackOptions
    ): LicenseAttestationProfilePack;
    getLicenseAttestationProfiles(): LicenseAttestationProfile[];
    getLicenseAttestationProfile(id: string): LicenseAttestationProfile | undefined;
    setDefaultLicenseAttestationProfile(id: string | null): AdaptiveInterfaceEngine;
    setLicenseAttestorFromProfile(id: string, overrides?: JsonObject): LicenseAttestorBindingResult | undefined;
    registerSensorSchema(type: string, schema: JsonObject): AdaptiveInterfaceEngine;
    registerSensorAdapter(registration: SensorAdapterRegistration): AdaptiveInterfaceEngine;
    connectSensorAdapter(type: string): Promise<void>;
    disconnectSensorAdapter(type: string): Promise<void>;
    testSensorAdapter(type: string): Promise<void>;
    updateTelemetryConsent(consent: TelemetryConsentMap, context?: JsonObject): void;
    getTelemetryConsent(): TelemetryConsentSnapshot;
    getTelemetryAuditTrail(): TelemetryAuditEntry[];
    getLicenseCommercializationSummary(): LicenseCommercializationSummary | null;
    getLicenseCommercializationReporter(): LicenseCommercializationReporter | null;
    getLicenseCommercializationSnapshotStore(): LicenseCommercializationSnapshotStore | null;
    captureLicenseCommercializationSnapshot(context?: JsonObject): LicenseCommercializationSnapshot | null;
    getLicenseCommercializationSnapshots(options?: CommercializationSnapshotQuery): LicenseCommercializationSnapshot[];
    getLicenseCommercializationKpiReport(options?: CommercializationKpiQuery): LicenseCommercializationKpiReport;
    exportLicenseCommercializationSnapshots(
        options?: CommercializationSnapshotExportOptions
    ): CommercializationSnapshotExportResult | Promise<CommercializationSnapshotExportResult>;
    startLicenseCommercializationSnapshotSchedule(intervalMs: number, context?: JsonObject): unknown;
    stopLicenseCommercializationSnapshotSchedule(): AdaptiveInterfaceEngine;
    setLicense(license: LicensePayload | null): void;
    validateLicense(context?: JsonObject): Promise<LicenseManagerStatus>;
    getLicenseStatus(): LicenseManagerStatus;
    getLicenseHistory(): LicenseManagerStatus[];
    getLicenseAttestationHistory(): unknown[];
    composeProjectionField(
        blueprintOrLayout: unknown,
        design?: unknown,
        context?: unknown,
        options?: JsonObject
    ): unknown;
    getProjectionFrame(): unknown;
    stepProjectionSimulation(options?: JsonObject): unknown;
    registerProjectionScenario(descriptor: ProjectionScenarioDescriptor): string | ProjectionScenarioDescriptor;
    registerProjectionScenarioPack(pack: ProjectionScenarioDescriptor | ProjectionScenarioDescriptor[]): unknown;
    removeProjectionScenario(id: string): boolean;
    listProjectionScenarios(): ProjectionScenarioDescriptor[];
    listProjectionScenarioPacks(): ProjectionScenarioDescriptor[];
    getProjectionScenario(id: string): ProjectionScenarioDescriptor | undefined;
    getProjectionScenarioPack(id: string): ProjectionScenarioDescriptor | undefined;
    setActiveProjectionScenario(id: string): void;
    getActiveProjectionScenario(): ProjectionScenarioDescriptor | null;
    getProjectionScenarioCatalog(): ProjectionScenarioCatalog;
    setLicenseAttestor(attestor: LicenseAttestor, options?: JsonObject): void;
    requestLicenseAttestation(context?: JsonObject): Promise<LicenseManagerStatus>;
    onLicenseStatusChange(listener: (status: LicenseManagerStatus) => void): () => void;
    createConsentPanel(options?: Omit<ConsentPanelOptions, 'container'> & { container: HTMLElement }): ConsentPanelInstance;
}

export function createAdaptiveSDK(config?: AdaptiveSDKConfig): AdaptiveSDKInstance;

