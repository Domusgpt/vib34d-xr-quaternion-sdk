const DEFAULT_VARIATION = 'default';
const DEFAULT_PATTERN_ID = 'prismatic-glass';

function createDefaultSpec(variation = DEFAULT_VARIATION, overrides = {}) {
  return normalizeSpec({
    variation,
    pattern: {
      id: overrides.patternId ?? DEFAULT_PATTERN_ID,
      title: overrides.patternTitle ?? 'Prismatic Glass Cascade',
      description: overrides.patternDescription ?? 'Ambient glass refractions tuned for rotor-driven XR previews.'
    },
    monetization: {
      tier: overrides.tier ?? 'standard',
      sku: overrides.sku ?? 'vib34d-standard',
      currency: overrides.currency ?? 'USD',
      amount: overrides.amount ?? 0
    },
    integration: {
      blueprint: overrides.blueprint ?? 'adaptive-default',
      projection: overrides.projection ?? 'glass-holographic',
      localizationHints: overrides.localizationHints ?? ['stage-confidence', 'anchor-confidence']
    }
  });
}

function normalizeSpec(spec) {
  const variation = spec.variation || DEFAULT_VARIATION;
  const pattern = spec.pattern || {};
  const monetization = spec.monetization || {};
  const integration = spec.integration || {};
  return {
    variation,
    pattern: {
      id: pattern.id || DEFAULT_PATTERN_ID,
      title: pattern.title || 'Untitled Pattern',
      description: pattern.description || ''
    },
    monetization: {
      tier: monetization.tier || 'standard',
      sku: monetization.sku || `vib34d-${variation}`,
      currency: monetization.currency || 'USD',
      amount: monetization.amount ?? 0
    },
    integration: {
      blueprint: integration.blueprint || 'adaptive-default',
      projection: integration.projection || 'glass-holographic',
      localizationHints: Array.isArray(integration.localizationHints)
        ? integration.localizationHints
        : ['stage-confidence']
    }
  };
}

export class DesignLanguageManager {
  constructor(engine, options = {}) {
    this.engine = engine;
    this.patternRegistry = options.patternRegistry ?? null;
    this.catalogMetadata = options.marketplace ?? {};
    this.designSpecs = new Map();

    const bootstrapSpecs = Array.isArray(options.designSpecs) ? options.designSpecs : [options.defaultDesignSpec];
    let seeded = false;
    for (const spec of bootstrapSpecs) {
      if (spec) {
        this.registerDesignSpec(spec);
        seeded = true;
      }
    }
    if (!seeded) {
      this.registerDesignSpec(createDefaultSpec(DEFAULT_VARIATION, options));
    }
  }

  registerDesignSpec(spec) {
    const normalized = normalizeSpec(spec ?? {});
    this.designSpecs.set(normalized.variation, normalized);
    return normalized;
  }

  getDesignSpec(variation = DEFAULT_VARIATION) {
    return this.designSpecs.get(variation) || this.designSpecs.get(DEFAULT_VARIATION) || createDefaultSpec();
  }

  listDesignSpecs() {
    return Array.from(this.designSpecs.values());
  }

  exportMarketplaceCatalog() {
    return {
      metadata: {
        ...this.catalogMetadata,
        generatedAt: new Date().toISOString()
      },
      designs: this.listDesignSpecs()
    };
  }
}
