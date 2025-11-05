/**
 * VIB34D Integrated Engine
 * Base engine class for the VIB34D visualization system
 * Provides core functionality for parameter management, variation control, and visualizer coordination
 */

import { ParameterManager } from './Parameters.js';

export class VIB34DIntegratedEngine {
  constructor(options = {}) {
    this.options = options;
    this.systems = new Map();
    this.visualizers = new Map();
    this.initialized = false;
    this.running = false;

    // Initialize parameter manager
    this.parameterManager = new ParameterManager();

    // Initialize variation manager
    this.variationManager = new VariationManager();
    this.currentVariation = 0;

    // Initialize event listeners
    this.listeners = new Map();
  }

  /**
   * Register a system with the engine
   */
  registerSystem(name, system) {
    this.systems.set(name, system);
    return this;
  }

  /**
   * Get a registered system
   */
  getSystem(name) {
    return this.systems.get(name);
  }

  /**
   * Register a visualizer
   */
  registerVisualizer(name, visualizer) {
    this.visualizers.set(name, visualizer);
    return this;
  }

  /**
   * Get a visualizer by name
   */
  getVisualizer(name) {
    return this.visualizers.get(name);
  }

  /**
   * Unregister a visualizer
   */
  unregisterVisualizer(name) {
    this.visualizers.delete(name);
    return this;
  }

  /**
   * Get a visual system (alias for getVisualizer for compatibility)
   */
  getVisualSystem(name) {
    return this.getVisualizer(name);
  }

  /**
   * Initialize the engine
   */
  initialize() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Parameter management shortcuts
   */
  getParameter(name) {
    return this.parameterManager.getParameter(name);
  }

  setParameter(name, value) {
    this.parameterManager.setParameter(name, value);
    return this;
  }

  getAllParameters() {
    return this.parameterManager.getAllParameters();
  }

  /**
   * Variation shortcuts
   */
  getVariationName() {
    return this.variationManager.getVariationName(this.currentVariation);
  }

  getVariationPreset(index) {
    return this.variationManager.getVariationPreset(index);
  }

  /**
   * Update all visualizers
   */
  updateVisualizers() {
    const params = this.parameterManager.getAllParameters();

    for (const [name, visualizer] of this.visualizers) {
      if (typeof visualizer.update === 'function') {
        visualizer.update(params);
      }
      if (typeof visualizer.setParameters === 'function') {
        visualizer.setParameters(params);
      }
    }
  }

  /**
   * Set the current variation
   */
  setVariation(index) {
    this.currentVariation = index;
    this.parameterManager.setParameter('variation', index);

    // Apply variation preset if it exists
    const preset = this.variationManager.getVariationPreset(index);
    if (preset) {
      for (const [param, value] of Object.entries(preset)) {
        this.parameterManager.setParameter(param, value);
      }
    }

    this.emit('variationChanged', { index, preset });
    return this;
  }

  /**
   * Update the engine (called per frame)
   */
  update(deltaTime) {
    if (!this.running) {
      return;
    }
    // Override in subclass for custom update logic
    this.updateVisualizers();
  }

  /**
   * Start the engine
   */
  start() {
    this.running = true;
    this.emit('start');
    return this;
  }

  /**
   * Stop the engine
   */
  stop() {
    this.running = false;
    this.emit('stop');
    return this;
  }

  /**
   * Reset the engine to initial state
   */
  reset() {
    this.currentVariation = 0;
    this.setVariation(0);
    this.emit('reset');
    return this;
  }

  /**
   * Event emitter pattern
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
    return this;
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(data));
    }
  }

  /**
   * Cleanup and dispose resources
   */
  dispose() {
    this.systems.clear();
    this.visualizers.clear();
    this.listeners.clear();
    this.initialized = false;
  }
}

/**
 * Variation Manager
 * Manages variation presets and names
 */
export class VariationManager {
  constructor() {
    // Default variation names
    this.variationNames = {
      0: 'Classic',
      1: 'Ethereal',
      2: 'Geometric',
      3: 'Organic',
      4: 'Crystalline',
      5: 'Fractal',
      6: 'Holographic',
      7: 'Quantum',
      8: 'Minimal',
      9: 'Maximal'
    };

    // Variation presets (parameter configurations)
    this.variationPresets = {
      0: { // Classic
        rotationSpeed: 0.5,
        complexity: 0.5,
        colorIntensity: 0.8,
        intensity: 0.5,
        speed: 1.0,
        chaos: 0.2,
        saturation: 0.8
      },
      1: { // Ethereal
        rotationSpeed: 0.3,
        complexity: 0.3,
        colorIntensity: 0.6,
        intensity: 0.3,
        speed: 0.5,
        chaos: 0.1,
        saturation: 0.6
      },
      2: { // Geometric
        rotationSpeed: 0.6,
        complexity: 0.7,
        colorIntensity: 0.9,
        intensity: 0.7,
        speed: 0.8,
        chaos: 0.05,
        saturation: 0.9,
        morphFactor: 0.5
      },
      3: { // Organic
        rotationSpeed: 0.7,
        complexity: 0.8,
        colorIntensity: 0.7,
        intensity: 0.6,
        speed: 1.2,
        chaos: 0.4,
        saturation: 0.7,
        morphFactor: 1.5
      },
      4: { // Crystalline
        rotationSpeed: 0.4,
        complexity: 0.85,
        colorIntensity: 1.0,
        intensity: 0.8,
        speed: 0.6,
        chaos: 0.1,
        saturation: 1.0
      },
      5: { // Fractal
        rotationSpeed: 0.8,
        complexity: 0.9,
        colorIntensity: 0.8,
        intensity: 0.7,
        speed: 1.5,
        chaos: 0.6,
        saturation: 0.8,
        morphFactor: 1.8
      },
      6: { // Holographic
        rotationSpeed: 0.6,
        complexity: 0.75,
        colorIntensity: 0.9,
        intensity: 0.9,
        speed: 1.0,
        chaos: 0.3,
        saturation: 0.9,
        hue: 280
      },
      7: { // Quantum
        rotationSpeed: 0.9,
        complexity: 0.95,
        colorIntensity: 0.7,
        intensity: 0.6,
        speed: 2.0,
        chaos: 0.8,
        saturation: 0.7,
        dimension: 4.0
      },
      8: { // Minimal
        rotationSpeed: 0.2,
        complexity: 0.2,
        colorIntensity: 0.4,
        intensity: 0.2,
        speed: 0.3,
        chaos: 0.05,
        saturation: 0.4
      },
      9: { // Maximal
        rotationSpeed: 1.0,
        complexity: 1.0,
        colorIntensity: 1.0,
        intensity: 1.0,
        speed: 2.5,
        chaos: 0.9,
        saturation: 1.0,
        morphFactor: 2.0
      }
    };
  }

  /**
   * Get the name for a variation index
   */
  getVariationName(index) {
    return this.variationNames[index] || `Variation ${index}`;
  }

  /**
   * Get the preset parameters for a variation
   */
  getVariationPreset(index) {
    return this.variationPresets[index] || null;
  }

  /**
   * Register a custom variation
   */
  registerVariation(index, name, preset = {}) {
    this.variationNames[index] = name;
    if (Object.keys(preset).length > 0) {
      this.variationPresets[index] = preset;
    }
  }

  /**
   * Get variation index by name
   */
  getVariationIndex(name) {
    for (const [index, varName] of Object.entries(this.variationNames)) {
      if (varName === name) {
        return parseInt(index);
      }
    }
    return -1;
  }

  /**
   * Get the number of variations
   */
  getVariationCount() {
    return Object.keys(this.variationNames).length;
  }

  /**
   * Get all variation names as an array
   */
  getAllVariationNames() {
    return Object.values(this.variationNames);
  }
}
