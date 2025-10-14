import { LayoutStrategy } from './LayoutStrategy.js';

export class HapticFallbackStrategy extends LayoutStrategy {
    constructor(options = {}) {
        super({ id: 'haptic-fallback', priority: options.priority ?? 40 });
        this.activationStress = options.activationStress ?? 0.45;
        this.minIntensity = options.minIntensity ?? 0.35;
    }

    compose({ layout, shared }) {
        const stress = shared.focus?.stress ?? 0;
        const intensity = layout.intensity ?? shared.focus?.intensity ?? 0.5;
        if (stress < this.activationStress && intensity > this.minIntensity) {
            return;
        }

        layout.zones = (layout.zones || []).map(zone => {
            const updated = { ...zone };
            updated.recommendedComponents = [...(zone.recommendedComponents || [])];
            if (!updated.recommendedComponents.includes('haptic-pulse')) {
                updated.recommendedComponents.push('haptic-pulse');
            }
            updated.layeringDepth = Math.min(1, (zone.layeringDepth ?? 0.4) + 0.12);
            return updated;
        });
    }
}
