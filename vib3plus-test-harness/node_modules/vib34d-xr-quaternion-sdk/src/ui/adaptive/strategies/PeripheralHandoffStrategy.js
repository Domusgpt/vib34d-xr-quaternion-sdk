import { LayoutStrategy } from './LayoutStrategy.js';

export class PeripheralHandoffStrategy extends LayoutStrategy {
    constructor(options = {}) {
        super({ id: 'peripheral-handoff', priority: options.priority ?? 30 });
        this.primaryBias = options.primaryBias ?? 0.6;
        this.handoffThreshold = options.handoffThreshold ?? 0.55;
    }

    prepare({ context, shared }) {
        shared.environment = context.environment || { luminance: 0.4, noiseLevel: 0.2 };
    }

    compose({ layout, shared }) {
        if (!layout.zones) return;

        const environment = shared.environment;
        const intensity = shared.focus?.intensity ?? layout.intensity ?? 0.5;
        const noiseInfluence = environment.noiseLevel ?? 0;
        const luminanceInfluence = environment.luminance ?? 0;

        const primary = layout.zones.find(zone => zone.id === 'primary');
        const peripheral = layout.zones.find(zone => zone.id === 'peripheral');
        const ambient = layout.zones.find(zone => zone.id === 'ambient');

        if (!primary) return;

        if (intensity > this.handoffThreshold && noiseInfluence > 0.25) {
            const shift = Math.min(0.2, (intensity - this.handoffThreshold) * 0.4 + noiseInfluence * 0.1);
            primary.occupancy = Math.max(0.35, primary.occupancy - shift);
            if (peripheral) {
                peripheral.occupancy = Math.min(0.95, peripheral.occupancy + shift * 0.7);
            }
            if (ambient) {
                ambient.occupancy = Math.min(0.8, ambient.occupancy + shift * 0.3);
            }
        } else {
            primary.occupancy = Math.max(this.primaryBias, primary.occupancy);
        }

        if (peripheral) {
            peripheral.recommendedComponents = peripheral.recommendedComponents || [];
            if (intensity < 0.45 && luminanceInfluence < 0.35) {
                if (!peripheral.recommendedComponents.includes('glow-band')) {
                    peripheral.recommendedComponents.push('glow-band');
                }
            }
        }
    }
}
