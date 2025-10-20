export class VIB34DIntegratedEngine {
  constructor() {
    this.visualizers = new Map();
    this.parameterManager = createParameterManager();
    this.variationManager = createVariationManager();
    this.currentVariation = 0;
    this.marketplaceHooks = {};
  }

  updateVisualizers() {
    for (const visualizer of this.visualizers.values()) {
      if (typeof visualizer.update === 'function') {
        visualizer.update();
      }
    }
    return this;
  }

  registerVisualizer(name, instance) {
    this.visualizers.set(name, instance);
    return this;
  }

  removeVisualizer(name) {
    this.visualizers.delete(name);
    return this;
  }

  getVisualSystem(name) {
    return this.visualizers.get(name) ?? null;
  }

  setVariation(index) {
    if (Number.isInteger(index) && index >= 0) {
      this.currentVariation = index;
    }
    return this;
  }
}

function createParameterManager() {
  const store = new Map();
  return {
    setParameter(name, value) {
      if (typeof name === 'string') {
        store.set(name, value);
      }
    },
    getParameter(name) {
      return store.get(name);
    },
    toJSON() {
      return Object.fromEntries(store.entries());
    }
  };
}

function createVariationManager() {
  const variations = ['default'];
  return {
    getVariationName(index) {
      if (!Number.isInteger(index) || index < 0 || index >= variations.length) {
        return variations[0];
      }
      return variations[index];
    },
    registerVariation(name) {
      if (typeof name === 'string' && !variations.includes(name)) {
        variations.push(name);
      }
    },
    listVariations() {
      return [...variations];
    }
  };
}
