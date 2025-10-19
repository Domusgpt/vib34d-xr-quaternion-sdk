export class VIB34DIntegratedEngine {
  constructor() {
    this.visualSystems = new Map();
    this.currentVariation = 0;
    this.variationManager = {
      getVariationName: () => 'default',
    };
  }

  registerVisualSystem(name, system) {
    if (name && system) {
      this.visualSystems.set(name, system);
    }
    return this;
  }

  getVisualSystem(name) {
    if (!name) {
      return null;
    }
    return this.visualSystems.get(name) ?? null;
  }

  setVariation(index) {
    if (Number.isFinite(index)) {
      this.currentVariation = Number(index);
    }
    return this;
  }

  dispose() {}
}

export default VIB34DIntegratedEngine;
