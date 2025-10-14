import { VIB34DIntegratedEngine } from './Engine.js';
import { SensoryInputBridge } from '../ui/adaptive/SensoryInputBridge.js';
import { SpatialLayoutSynthesizer } from '../ui/adaptive/SpatialLayoutSynthesizer.js';
import { DesignLanguageManager } from '../features/DesignLanguageManager.js';
import { ProductTelemetryHarness } from '../product/ProductTelemetryHarness.js';
import { buildLayoutBlueprint } from '../ui/adaptive/renderers/LayoutBlueprintRenderer.js';
import { ProjectionFieldComposer } from '../ui/adaptive/renderers/ProjectionFieldComposer.js';
import { ProjectionScenarioSimulator } from '../ui/adaptive/simulators/ProjectionScenarioSimulator.js';
import { ProjectionScenarioCatalog, createProjectionScenarioCatalog } from '../ui/adaptive/simulators/ProjectionScenarioCatalog.js';

/**
 * AdaptiveInterfaceEngine
 * ------------------------------------------------------------
 * Productized variant of the VIB34D engine tailored for wearable and ambient
 * UI design. Introduces adaptive sensory input, layout synthesis, and
 * monetization scaffolding.
 */
export class AdaptiveInterfaceEngine extends VIB34DIntegratedEngine {
    constructor(options = {}) {
        super();

        this.sensoryBridge = new SensoryInputBridge(options.sensory);
        this.layoutSynthesizer = new SpatialLayoutSynthesizer(options.layout);
        this.designLanguageManager = new DesignLanguageManager(this, options.design);
        this.telemetry = new ProductTelemetryHarness(options.telemetry);
        this.marketplaceHooks = options.marketplaceHooks || {};
        this.projectionComposer = new ProjectionFieldComposer(options.projection?.composer);
        this.projectionSimulator = new ProjectionScenarioSimulator({
            ...(options.projection?.simulator || {}),
            composer: this.projectionComposer
        });
        const catalogOption = options.projection?.catalog;
        if (catalogOption instanceof ProjectionScenarioCatalog) {
            this.projectionCatalog = catalogOption;
        } else if (catalogOption) {
            this.projectionCatalog = createProjectionScenarioCatalog(catalogOption);
        } else {
            this.projectionCatalog = createProjectionScenarioCatalog();
        }
        this.projectionCatalog?.applyToSimulator?.(this.projectionSimulator);

        if (typeof this.sensoryBridge.setValidationReporter === 'function') {
            this.sensoryBridge.setValidationReporter(issue => {
                this.telemetry.recordSchemaIssue(issue);
            });
        }

        this.activeLayout = null;
        this.activeDesignSpec = null;
        this.activeBlueprint = null;
        this.activeProjectionField = null;
        this.adaptiveUpdateNeeded = true;

        this.initializeAdaptivePipeline();
    }

    initializeAdaptivePipeline() {
        const markDirty = () => {
            this.adaptiveUpdateNeeded = true;
        };

        ['focus', 'intention', 'biometrics', 'environment', 'gesture'].forEach(channel => {
            this.sensoryBridge.subscribe(channel, markDirty);
        });

        this.sensoryBridge.subscribe('focus', vector => {
            this.telemetry.track('adaptive.focus', { x: vector.x, y: vector.y, depth: vector.depth });
        });

        this.sensoryBridge.subscribe('gesture', gesture => {
            if (gesture?.intent) {
                this.telemetry.track('adaptive.gesture', { intent: gesture.intent });
            }
        });

        this.telemetry.start();
        this.sensoryBridge.start();
        this.syncDesignSpec();
    }

    registerLayoutStrategy(strategy) {
        this.layoutSynthesizer.registerStrategy(strategy);
        this.telemetry.track('design.layout.strategy_registered', { id: strategy.id });
        return this;
    }

    registerLayoutAnnotation(annotation) {
        this.layoutSynthesizer.registerAnnotation(annotation);
        this.telemetry.track('design.layout.annotation_registered', { id: annotation.id });
        return this;
    }

    registerSensorSchema(type, schema) {
        this.sensoryBridge.registerSchema(type, schema);
        this.telemetry.track('sensors.schema_registered', { type });
        return this;
    }

    registerTelemetryProvider(provider) {
        this.telemetry.registerProvider(provider);
        this.telemetry.track('design.telemetry.provider_registered', { id: provider.id });
        return this;
    }

    registerTelemetryRequestMiddleware(middleware) {
        this.telemetry.registerRequestMiddleware(middleware);
        return this;
    }

    clearTelemetryRequestMiddleware() {
        this.telemetry.clearRequestMiddleware();
        return this;
    }

    registerLicenseAttestationProfile(profileOrId, maybeProfile) {
        return this.telemetry.registerLicenseAttestationProfile(profileOrId, maybeProfile);
    }

    registerLicenseAttestationProfilePack(packOrId, options = {}) {
        return this.telemetry.registerLicenseAttestationProfilePack(packOrId, options);
    }

    setDefaultLicenseAttestationProfile(id) {
        this.telemetry.setDefaultLicenseAttestationProfile(id);
        return this;
    }

    applyLicenseAttestationProfile(id, overrides = {}) {
        return this.telemetry.setLicenseAttestorFromProfile(id, overrides);
    }

    removeTelemetryProvider(id) {
        this.telemetry.removeProvider(id);
        this.telemetry.track('design.telemetry.provider_removed', { id });
        return this;
    }

    getTelemetryAuditTrail() {
        return this.telemetry.getAuditTrail();
    }

    getLicenseCommercializationSummary() {
        return this.telemetry.getCommercializationSummary();
    }

    getLicenseCommercializationReporter() {
        return this.telemetry.getCommercializationReporter();
    }

    getLicenseCommercializationSnapshotStore() {
        return this.telemetry.getCommercializationSnapshotStore();
    }

    captureLicenseCommercializationSnapshot(context = {}) {
        return this.telemetry.captureCommercializationSnapshot(context);
    }

    getLicenseCommercializationSnapshots(options = {}) {
        return this.telemetry.getCommercializationSnapshots(options);
    }

    getLicenseCommercializationKpiReport(options = {}) {
        return this.telemetry.getCommercializationKpiReport(options);
    }

    exportLicenseCommercializationSnapshots(options = {}) {
        return this.telemetry.exportCommercializationSnapshots(options);
    }

    startLicenseCommercializationSnapshotSchedule(intervalMs, context = {}) {
        return this.telemetry.startCommercializationSnapshotSchedule(intervalMs, context);
    }

    stopLicenseCommercializationSnapshotSchedule() {
        this.telemetry.stopCommercializationSnapshotSchedule();
        return this;
    }

    registerSensorAdapter(type, adapter, options = {}) {
        this.sensoryBridge.registerAdapter(type, adapter);
        this.telemetry.track('sensors.adapter.registered', {
            type,
            lifecycle: {
                connect: typeof adapter.connect === 'function',
                disconnect: typeof adapter.disconnect === 'function',
                test: typeof adapter.test === 'function'
            }
        });

        if (options.autoConnect ?? true) {
            this.connectSensorAdapter(type).catch(error => {
                this.telemetry.track('sensors.adapter.connect_failed', {
                    type,
                    message: error?.message || 'Unknown error'
                }, { classification: 'compliance' });
            });
        }
        return this;
    }

    async connectSensorAdapter(type) {
        try {
            await this.sensoryBridge.connectAdapter(type);
            this.telemetry.track('sensors.adapter.connected', { type });
        } catch (error) {
            this.telemetry.track('sensors.adapter.connect_failed', {
                type,
                message: error?.message || 'Unknown error'
            }, { classification: 'compliance' });
            throw error;
        }
    }

    async disconnectSensorAdapter(type) {
        try {
            await this.sensoryBridge.disconnectAdapter(type);
            this.telemetry.track('sensors.adapter.disconnected', { type });
        } catch (error) {
            this.telemetry.track('sensors.adapter.disconnect_failed', {
                type,
                message: error?.message || 'Unknown error'
            }, { classification: 'compliance' });
            throw error;
        }
    }

    async testSensorAdapter(type) {
        const result = await this.sensoryBridge.testAdapter(type);
        this.telemetry.track('sensors.adapter.tested', { type, result: result ?? null });
        return result;
    }

    updateVisualizers() {
        if (this.adaptiveUpdateNeeded) {
            const context = this.sensoryBridge.getSnapshot();
            this.activeLayout = this.layoutSynthesizer.generateLayout(context);
            this.applyLayoutToParameters(this.activeLayout);
            this.activeBlueprint = buildLayoutBlueprint(this.activeLayout, this.activeDesignSpec, context);
            this.activeProjectionField = this.projectionComposer.render(this.activeBlueprint, {
                gazeVelocity: context?.eyeTracking?.velocity ?? context?.focus?.velocity ?? 0.35,
                neuralCoherence: context?.neural?.coherence ?? context?.intention?.confidence ?? 0.4,
                hapticFeedback: context?.gesture?.haptic ?? 0.35,
                ambientVariance: context?.environment?.motion ?? 0.3,
                gestureIntent: {
                    intensity: context?.gesture?.intensity ?? 0.3,
                    vector: {
                        x: context?.gesture?.vector?.x ?? context?.focus?.x ?? 0.5,
                        y: context?.gesture?.vector?.y ?? context?.focus?.y ?? 0.5,
                        z: context?.gesture?.vector?.z ?? context?.focus?.depth ?? 0.4
                    }
                }
            });
            this.projectionSimulator.observeAdaptiveState({
                layout: this.activeLayout,
                blueprint: this.activeBlueprint,
                context: {
                    gazeVelocity: context?.eyeTracking?.velocity ?? 0.35,
                    neuralCoherence: context?.intention?.confidence ?? 0.4,
                    hapticFeedback: context?.gesture?.haptic ?? 0.35,
                    ambientVariance: context?.environment?.motion ?? 0.3,
                    gestureIntent: {
                        intensity: context?.gesture?.intensity ?? 0.3,
                        vector: {
                            x: context?.gesture?.vector?.x ?? context?.focus?.x ?? 0.5,
                            y: context?.gesture?.vector?.y ?? context?.focus?.y ?? 0.5,
                            z: context?.gesture?.vector?.z ?? context?.focus?.depth ?? 0.4
                        }
                    }
                }
            });
            this.emitAdaptiveUpdate(context, this.activeLayout);
            this.adaptiveUpdateNeeded = false;
        }

        super.updateVisualizers();
    }

    applyLayoutToParameters(layout) {
        if (!layout) return;
        this.parameterManager.setParameter('intensity', layout.intensity);
        this.parameterManager.setParameter('speed', 0.5 + layout.motion.velocity * 1.5);
        this.parameterManager.setParameter('hue', layout.colorAdaptation.hueShift);
        this.parameterManager.setParameter('saturation', layout.colorAdaptation.saturation / 100);

        const geometryBias = layout.zones.find(zone => zone.id === 'primary')?.occupancy || 0.6;
        const geometryIndex = Math.round(geometryBias * 7);
        this.parameterManager.setParameter('geometry', geometryIndex);
    }

    emitAdaptiveUpdate(context, layout) {
        if (typeof this.marketplaceHooks.onAdaptiveUpdate === 'function') {
            this.marketplaceHooks.onAdaptiveUpdate({ context, layout, design: this.activeDesignSpec });
        }
        if (typeof this.marketplaceHooks.onProjectionUpdate === 'function') {
            this.marketplaceHooks.onProjectionUpdate({
                context,
                layout,
                design: this.activeDesignSpec,
                blueprint: this.activeBlueprint,
                projection: this.activeProjectionField
            });
        }
    }

    setVariation(index) {
        super.setVariation(index);
        this.syncDesignSpec();
    }

    syncDesignSpec() {
        const variationName = this.variationManager.getVariationName(this.currentVariation);
        this.activeDesignSpec = this.designLanguageManager.getDesignSpec(variationName);
        this.telemetry.track('design.spec.activated', {
            variation: variationName,
            pattern: this.activeDesignSpec.pattern?.id,
            tier: this.activeDesignSpec.monetization.tier
        });

        if (typeof this.marketplaceHooks.onPatternChange === 'function') {
            this.marketplaceHooks.onPatternChange(this.activeDesignSpec);
        }
    }

    exportMarketplaceCatalog() {
        return this.designLanguageManager.exportMarketplaceCatalog();
    }

    composeProjectionField(blueprintOrLayout, design = this.activeDesignSpec, context = {}, options = {}) {
        const blueprint = blueprintOrLayout?.zones
            ? buildLayoutBlueprint(blueprintOrLayout, design || this.activeDesignSpec, context)
            : blueprintOrLayout || this.activeBlueprint;
        if (!blueprint) {
            return null;
        }
        return this.projectionComposer.compose(blueprint, context, options);
    }

    getProjectionFrame() {
        return this.projectionSimulator.getLastResult() || (this.activeProjectionField
            ? {
                id: 'realtime',
                name: 'Realtime Adaptive',
                progress: 1,
                cycleMs: 0,
                blueprint: this.activeBlueprint,
                context: null,
                composition: this.activeProjectionField,
                anchors: []
            }
            : null);
    }

    stepProjectionSimulation(options = {}) {
        return this.projectionSimulator.step(options);
    }

    registerProjectionScenario(descriptor) {
        const scenario = this.projectionCatalog
            ? this.projectionCatalog.registerScenario(descriptor)
            : descriptor;
        return this.projectionSimulator.registerScenario(scenario);
    }

    removeProjectionScenario(id) {
        this.projectionCatalog?.removeScenario?.(id);
        return this.projectionSimulator.removeScenario(id);
    }

    listProjectionScenarios() {
        if (this.projectionCatalog) {
            return this.projectionCatalog.listScenarios();
        }
        return this.projectionSimulator.listScenarios();
    }

    getProjectionScenario(id) {
        if (this.projectionCatalog) {
            const scenario = this.projectionCatalog.getScenario(id);
            if (scenario) {
                return scenario;
            }
        }
        return this.projectionSimulator.getScenario(id);
    }

    setActiveProjectionScenario(id) {
        return this.projectionSimulator.setActiveScenario(id);
    }

    getActiveProjectionScenario() {
        return this.projectionSimulator.getActiveScenario();
    }

    registerProjectionScenarioPack(pack) {
        const registeredPack = this.projectionCatalog
            ? this.projectionCatalog.registerScenarioPack(pack)
            : null;
        if (registeredPack) {
            for (const scenarioId of registeredPack.scenarios) {
                const scenario = this.projectionCatalog.getScenario(scenarioId);
                if (scenario) {
                    this.projectionSimulator.registerScenario(scenario);
                }
            }
        }
        return registeredPack;
    }

    listProjectionScenarioPacks() {
        return this.projectionCatalog ? this.projectionCatalog.listScenarioPacks() : [];
    }

    getProjectionScenarioPack(id) {
        return this.projectionCatalog ? this.projectionCatalog.getScenarioPack(id) : null;
    }

    getProjectionScenarioCatalog() {
        if (!this.projectionCatalog) {
            return { packs: [], scenarios: [] };
        }
        return {
            packs: this.projectionCatalog.listScenarioPacks(),
            scenarios: this.projectionCatalog.listScenarios()
        };
    }

    dispose() {
        this.telemetry.stop();
        this.sensoryBridge.stop();
    }
}

