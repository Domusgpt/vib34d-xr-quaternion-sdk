import { LayoutStrategy } from './LayoutStrategy.js';

export class FocusWeightedStrategy extends LayoutStrategy {
    constructor(options = {}) {
        super({ id: 'focus-weighted', priority: options.priority ?? 10 });
        this.focusAmplifier = options.focusAmplifier ?? 1.2;
        this.engagementWeight = options.engagementWeight ?? 0.65;
        this.motionSensitivity = options.motionSensitivity ?? 0.35;
    }

    prepare({ context, layout, shared }) {
        const { focusVector = { x: 0.5, y: 0.5, depth: 0.3 }, engagementLevel = 0.4, biometricStress = 0 } = context;
        const focusMagnitude = Math.sqrt(
            Math.pow((focusVector.x ?? 0.5) - 0.5, 2) +
            Math.pow((focusVector.y ?? 0.5) - 0.5, 2) +
            Math.pow(((focusVector.depth ?? 0.3)) - 0.3, 2)
        );
        const invertedFocus = 1 - Math.min(focusMagnitude * this.focusAmplifier, 1);
        const engagementBoost = engagementLevel * this.engagementWeight;
        const stressPenalty = biometricStress * 0.45;
        const intensity = Math.max(0.1, Math.min(1, invertedFocus + engagementBoost - stressPenalty));

        layout.intensity = intensity;
        layout.typographyScale = Math.max(0.8, 1.0 + engagementLevel * 0.15 - biometricStress * 0.1);

        shared.focus = {
            intensity,
            stress: biometricStress
        };
    }

    compose({ context, layout }) {
        const { intentionVector = { x: 0, y: 0, z: 0, w: 0 }, gestureIntent, environment = { luminance: 0.4, noiseLevel: 0.2, motion: 0.2 } } = context;
        const vectorMagnitude = Math.sqrt(
            Math.pow(intentionVector.x ?? 0, 2) +
            Math.pow(intentionVector.y ?? 0, 2) +
            Math.pow(intentionVector.z ?? 0, 2) +
            Math.pow(intentionVector.w ?? 0, 2)
        );
        const baseVelocity = Math.min(1, vectorMagnitude * this.motionSensitivity + 0.1);
        layout.motion = {
            velocity: baseVelocity,
            bias: gestureIntent?.vector || { x: 0, y: 0, z: 0 },
            easing: gestureIntent?.intent === 'hold' ? 'ease-out' : 'ease-in-out'
        };

        layout.zones = (layout.zones || []).map(zone => {
            const visibility = (zone.visibility ?? 0.6) * (0.6 + layout.intensity * 0.4);
            const luminanceCompensation = 1 - (environment.luminance ?? 0) * 0.3;
            const noiseCompensation = 1 - (environment.noiseLevel ?? 0) * 0.2;
            const occupancy = Math.max(0.1, Math.min(1, visibility * luminanceCompensation * noiseCompensation));

            return {
                ...zone,
                occupancy,
                layeringDepth: this.computeLayering(zone.id, layout.intensity),
                recommendedComponents: this.recommendComponents(zone.id, layout.intensity)
            };
        });

        const ambientInfluence = (environment.luminance ?? 0) * 0.5 + (environment.motion ?? 0) * 0.35;
        const stressTint = (context.biometricStress ?? 0) * 12;
        layout.colorAdaptation = {
            hueShift: Math.round((ambientInfluence * 45 + 180) % 360),
            saturation: Math.max(40, 75 - stressTint),
            lightness: Math.max(30, 60 - (environment.luminance ?? 0) * 20)
        };
    }

    computeLayering(zoneId, intensity) {
        const base = zoneId === 'primary' ? 0.15 : zoneId === 'peripheral' ? 0.32 : 0.58;
        return Math.min(1, base + intensity * 0.4);
    }

    recommendComponents(zoneId, intensity) {
        if (zoneId === 'primary') {
            return intensity > 0.65 ? ['holographic-panel', 'adaptive-controls'] : ['glanceable-card'];
        }
        if (zoneId === 'peripheral') {
            return intensity > 0.5 ? ['ambient-indicator', 'intent-feedback'] : ['pulse-strip'];
        }
        return ['environmental-visualizer'];
    }
}
