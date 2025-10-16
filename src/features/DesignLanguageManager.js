export class DesignLanguageManager {
  constructor(engine, options = {}) {
    this.engine = engine;
    this.options = options;
    this.catalog = options.catalog ?? [];
  }

  getActiveDesign() {
    return this.options.defaultDesign ?? null;
  }

  getDesignSpec(variationName) {
    const id = variationName || 'default';
    return {
      id,
      pattern: { id },
      monetization: { tier: this.options.defaultTier ?? 'indie' },
    };
  }

  exportMarketplaceCatalog() {
    return Array.isArray(this.catalog) ? this.catalog : [];
  }
}

export default DesignLanguageManager;
