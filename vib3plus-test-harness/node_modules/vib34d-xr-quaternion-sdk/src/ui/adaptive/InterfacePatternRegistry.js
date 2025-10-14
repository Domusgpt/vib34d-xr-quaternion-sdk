/**
 * InterfacePatternRegistry
 * ------------------------------------------------------------
 * Catalogues adaptive UI patterns that can be rendered by the engine. These
 * patterns expose metadata for monetizable add-ons and integration with design
 * tooling.
 */

const DEFAULT_PATTERNS = [
    {
        id: 'neuro-glance-feed',
        name: 'Neuro Glance Feed',
        category: 'perception',
        subscriptionTier: 'pro',
        description: 'Micro-summaries that respond to attention bursts and biometric calmness.',
        components: ['glanceable-card', 'pulse-strip'],
        telemetry: {
            trackEngagement: true,
            metrics: ['dwell', 'confidence']
        }
    },
    {
        id: 'holo-command-ring',
        name: 'Holo Command Ring',
        category: 'interaction',
        subscriptionTier: 'enterprise',
        description: 'Circular intent-driven command palette for neural or gestural activation.',
        components: ['adaptive-controls', 'intent-feedback'],
        telemetry: {
            trackEngagement: true,
            metrics: ['activation', 'latency']
        }
    },
    {
        id: 'biometric-rituals',
        name: 'Biometric Rituals',
        category: 'wellness',
        subscriptionTier: 'starter',
        description: 'Ambient ambient rituals that respond to stress deltas and lighting changes.',
        components: ['ambient-indicator', 'environmental-visualizer'],
        telemetry: {
            trackEngagement: false,
            metrics: []
        }
    }
];

export class InterfacePatternRegistry {
    constructor(initialPatterns = DEFAULT_PATTERNS) {
        this.patterns = new Map();
        initialPatterns.forEach(pattern => this.patterns.set(pattern.id, pattern));
    }

    addPattern(pattern) {
        if (!pattern?.id) {
            throw new Error('Pattern must include an id');
        }
        this.patterns.set(pattern.id, pattern);
    }

    removePattern(id) {
        this.patterns.delete(id);
    }

    getPattern(id) {
        return this.patterns.get(id) || null;
    }

    listPatterns(filter = {}) {
        const entries = Array.from(this.patterns.values());
        const { category, subscriptionTier } = filter;
        return entries.filter(pattern => {
            const matchesCategory = category ? pattern.category === category : true;
            const matchesTier = subscriptionTier ? pattern.subscriptionTier === subscriptionTier : true;
            return matchesCategory && matchesTier;
        });
    }

    exportForMarketplace() {
        return this.listPatterns().map(pattern => ({
            id: pattern.id,
            name: pattern.name,
            tier: pattern.subscriptionTier,
            metadata: {
                description: pattern.description,
                components: pattern.components,
                telemetry: pattern.telemetry
            }
        }));
    }
}

