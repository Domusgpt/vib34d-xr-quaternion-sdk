import { FocusWeightedStrategy } from './strategies/FocusWeightedStrategy.js';
import { PeripheralHandoffStrategy } from './strategies/PeripheralHandoffStrategy.js';
import { HapticFallbackStrategy } from './strategies/HapticFallbackStrategy.js';
import { StressAlertAnnotation } from './annotations/StressAlertAnnotation.js';

const DEFAULT_SURFACES = [
    { id: 'primary', curvature: 0.12, visibility: 1 },
    { id: 'peripheral', curvature: 0.38, visibility: 0.6 },
    { id: 'ambient', curvature: 0.72, visibility: 0.45 }
];

export class SpatialLayoutSynthesizer {
    constructor(options = {}) {
        const {
            surfaces = DEFAULT_SURFACES,
            strategies = [],
            annotations = [],
            useDefaultStrategies = true,
            useDefaultAnnotations = true
        } = options;

        this.surfaces = surfaces.map(surface => ({ ...surface }));
        this.strategies = [];
        this.annotations = [];

        if (useDefaultStrategies) {
            this.registerStrategy(new FocusWeightedStrategy(options.focusStrategy || {}));
            this.registerStrategy(new PeripheralHandoffStrategy(options.peripheralStrategy || {}));
            this.registerStrategy(new HapticFallbackStrategy(options.hapticStrategy || {}));
        }

        strategies.forEach(strategy => this.registerStrategy(strategy));

        if (useDefaultAnnotations) {
            this.registerAnnotation(new StressAlertAnnotation(options.stressAnnotation || {}));
        }

        annotations.forEach(annotation => this.registerAnnotation(annotation));
    }

    registerStrategy(strategy) {
        this.strategies = [...this.strategies.filter(item => item.id !== strategy.id), strategy]
            .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    }

    registerAnnotation(annotation) {
        this.annotations = [...this.annotations.filter(item => item.id !== annotation.id), annotation]
            .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    }

    clearStrategies() {
        this.strategies = [];
    }

    clearAnnotations() {
        this.annotations = [];
    }

    generateLayout(context = {}) {
        const shared = {};
        const layout = this.createBaseLayout();

        for (const strategy of this.strategies) {
            strategy.prepare?.({ context, layout, shared, surfaces: this.surfaces });
        }

        for (const strategy of this.strategies) {
            strategy.compose?.({ context, layout, shared, surfaces: this.surfaces });
        }

        layout.annotations = this.resolveAnnotations({ context, layout, shared });

        return layout;
    }

    resolveAnnotations({ context, layout, shared }) {
        const appliedIds = new Set();
        const annotations = [];

        for (const annotation of this.annotations) {
            const dependenciesSatisfied = annotation.dependsOn?.every(dep => appliedIds.has(dep)) ?? true;
            if (!dependenciesSatisfied) continue;

            const shouldApply = annotation.shouldApply?.({ context, layout, shared }) ?? true;
            if (!shouldApply) continue;

            try {
                const built = annotation.build?.({ context, layout, shared });
                if (built) {
                    annotations.push({ id: annotation.id, ...built });
                    appliedIds.add(annotation.id);
                }
            } catch (error) {
                console.warn(`[SpatialLayoutSynthesizer] Annotation ${annotation.id} failed`, error);
            }
        }

        return annotations;
    }

    createBaseLayout() {
        return {
            intensity: 0.5,
            zones: this.surfaces.map(surface => ({
                id: surface.id,
                curvature: surface.curvature,
                visibility: surface.visibility,
                occupancy: 0.45,
                layeringDepth: surface.id === 'primary' ? 0.18 : surface.id === 'peripheral' ? 0.34 : 0.6,
                recommendedComponents: []
            })),
            motion: {
                velocity: 0,
                bias: { x: 0, y: 0, z: 0 },
                easing: 'ease-in-out'
            },
            typographyScale: 1,
            colorAdaptation: {
                hueShift: 180,
                saturation: 60,
                lightness: 48
            },
            annotations: []
        };
    }
}
