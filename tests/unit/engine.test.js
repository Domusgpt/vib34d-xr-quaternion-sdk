/**
 * Tests for VIB34DIntegratedEngine and VariationManager
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VIB34DIntegratedEngine, VariationManager } from '../../src/core/Engine.js';

describe('VIB34DIntegratedEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new VIB34DIntegratedEngine({
      enableTelemetry: false
    });
  });

  describe('Initialization', () => {
    it('should create engine with default options', () => {
      expect(engine).toBeDefined();
      expect(engine.parameterManager).toBeDefined();
      expect(engine.variationManager).toBeDefined();
      expect(engine.currentVariation).toBe(0);
    });

    it('should initialize visualizers map', () => {
      expect(engine.visualizers).toBeInstanceOf(Map);
      expect(engine.visualizers.size).toBe(0);
    });

    it('should set initial running state to false', () => {
      expect(engine.running).toBe(false);
    });

    it('should initialize event listeners map', () => {
      expect(engine.listeners).toBeInstanceOf(Map);
    });
  });

  describe('Visualizer Management', () => {
    it('should register a visualizer', () => {
      const mockVisualizer = {
        update: () => {},
        render: () => {}
      };

      engine.registerVisualizer('test-viz', mockVisualizer);
      expect(engine.visualizers.has('test-viz')).toBe(true);
      expect(engine.visualizers.get('test-viz')).toBe(mockVisualizer);
    });

    it('should unregister a visualizer', () => {
      const mockVisualizer = { update: () => {} };
      engine.registerVisualizer('test-viz', mockVisualizer);

      engine.unregisterVisualizer('test-viz');
      expect(engine.visualizers.has('test-viz')).toBe(false);
    });

    it('should get registered visualizer', () => {
      const mockVisualizer = { update: () => {} };
      engine.registerVisualizer('test-viz', mockVisualizer);

      const retrieved = engine.getVisualizer('test-viz');
      expect(retrieved).toBe(mockVisualizer);
    });

    it('should return undefined for non-existent visualizer', () => {
      const retrieved = engine.getVisualizer('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should update all registered visualizers', () => {
      let updateCount = 0;
      const mockVisualizer1 = {
        update: () => { updateCount++; }
      };
      const mockVisualizer2 = {
        update: () => { updateCount++; }
      };

      engine.registerVisualizer('viz1', mockVisualizer1);
      engine.registerVisualizer('viz2', mockVisualizer2);

      engine.updateVisualizers();
      expect(updateCount).toBe(2);
    });

    it('should handle visualizers without update method', () => {
      const mockVisualizer = { render: () => {} };
      engine.registerVisualizer('viz-no-update', mockVisualizer);

      // Should not throw error
      expect(() => engine.updateVisualizers()).not.toThrow();
    });
  });

  describe('Parameter Management', () => {
    it('should get parameter value', () => {
      engine.parameterManager.setParameter('testParam', 42);
      const value = engine.getParameter('testParam');
      expect(value).toBe(42);
    });

    it('should set parameter value', () => {
      engine.setParameter('newParam', 100);
      expect(engine.parameterManager.getParameter('newParam')).toBe(100);
    });

    it('should get all parameters', () => {
      engine.setParameter('param1', 1);
      engine.setParameter('param2', 2);

      const params = engine.getAllParameters();
      expect(params).toHaveProperty('param1', 1);
      expect(params).toHaveProperty('param2', 2);
    });
  });

  describe('Variation System', () => {
    it('should start with variation 0 (Classic)', () => {
      expect(engine.currentVariation).toBe(0);
    });

    it('should set variation by index', () => {
      engine.setVariation(3);
      expect(engine.currentVariation).toBe(3);
    });

    it('should get variation name', () => {
      engine.setVariation(1);
      const name = engine.getVariationName();
      expect(name).toBe('Ethereal');
    });

    it('should get variation preset', () => {
      const preset = engine.getVariationPreset(2);
      expect(preset).toBeDefined();
      expect(preset).toHaveProperty('rotationSpeed');
      expect(preset).toHaveProperty('complexity');
    });

    it('should apply variation preset to parameters', () => {
      engine.setVariation(5); // Fractal
      const params = engine.getAllParameters();

      // Fractal should have high complexity
      expect(params.complexity).toBeGreaterThan(0.7);
    });

    it('should emit variation change event', () => {
      let eventFired = false;
      engine.on('variationChanged', () => { eventFired = true; });

      engine.setVariation(4);
      expect(eventFired).toBe(true);
    });
  });

  describe('Event System', () => {
    it('should register event listener', () => {
      const handler = () => {};
      engine.on('testEvent', handler);

      expect(engine.listeners.has('testEvent')).toBe(true);
    });

    it('should emit event to all listeners', () => {
      let count = 0;
      const handler1 = () => { count++; };
      const handler2 = () => { count++; };

      engine.on('testEvent', handler1);
      engine.on('testEvent', handler2);
      engine.emit('testEvent');

      expect(count).toBe(2);
    });

    it('should pass data to event listeners', () => {
      let receivedData = null;
      engine.on('dataEvent', (data) => { receivedData = data; });

      engine.emit('dataEvent', { value: 42 });
      expect(receivedData).toEqual({ value: 42 });
    });

    it('should remove event listener', () => {
      let called = false;
      const handler = () => { called = true; };

      engine.on('testEvent', handler);
      engine.off('testEvent', handler);
      engine.emit('testEvent');

      expect(called).toBe(false);
    });
  });

  describe('Engine Lifecycle', () => {
    it('should start engine', () => {
      engine.start();
      expect(engine.running).toBe(true);
    });

    it('should stop engine', () => {
      engine.start();
      engine.stop();
      expect(engine.running).toBe(false);
    });

    it('should emit start event', () => {
      let startFired = false;
      engine.on('start', () => { startFired = true; });

      engine.start();
      expect(startFired).toBe(true);
    });

    it('should emit stop event', () => {
      let stopFired = false;
      engine.on('stop', () => { stopFired = true; });

      engine.start();
      engine.stop();
      expect(stopFired).toBe(true);
    });

    it('should reset engine state', () => {
      engine.setParameter('test', 100);
      engine.setVariation(5);

      engine.reset();

      expect(engine.currentVariation).toBe(0);
      // Parameters should be reset to variation 0 defaults
    });
  });

  describe('Update Loop', () => {
    it('should update with delta time', () => {
      let updateCalled = false;
      const mockVisualizer = {
        update: () => { updateCalled = true; }
      };

      engine.registerVisualizer('viz', mockVisualizer);
      engine.start(); // Engine must be running to update
      engine.update(16.67); // ~60fps

      expect(updateCalled).toBe(true);
    });

    it('should only update when running', () => {
      let updateCount = 0;
      const mockVisualizer = {
        update: () => { updateCount++; }
      };

      engine.registerVisualizer('viz', mockVisualizer);

      // Not running
      engine.update(16.67);
      expect(updateCount).toBe(0);

      // Start and update
      engine.start();
      engine.update(16.67);
      expect(updateCount).toBe(1);
    });
  });
});

describe('VariationManager', () => {
  let variationManager;

  beforeEach(() => {
    variationManager = new VariationManager();
  });

  describe('Initialization', () => {
    it('should initialize with 10 variations', () => {
      const names = Object.keys(variationManager.variationNames);
      expect(names.length).toBe(10);
    });

    it('should have all expected variation names', () => {
      const expectedNames = [
        'Classic', 'Ethereal', 'Geometric', 'Organic', 'Crystalline',
        'Fractal', 'Holographic', 'Quantum', 'Minimal', 'Maximal'
      ];

      expectedNames.forEach((name, index) => {
        expect(variationManager.variationNames[index]).toBe(name);
      });
    });

    it('should have presets for all variations', () => {
      for (let i = 0; i < 10; i++) {
        const preset = variationManager.variationPresets[i];
        expect(preset).toBeDefined();
      }
    });
  });

  describe('Variation Retrieval', () => {
    it('should get variation name by index', () => {
      expect(variationManager.getVariationName(0)).toBe('Classic');
      expect(variationManager.getVariationName(5)).toBe('Fractal');
      expect(variationManager.getVariationName(9)).toBe('Maximal');
    });

    it('should get variation preset by index', () => {
      const preset = variationManager.getVariationPreset(0);
      expect(preset).toHaveProperty('rotationSpeed');
      expect(preset).toHaveProperty('complexity');
      expect(preset).toHaveProperty('colorIntensity');
    });

    it('should get variation index by name', () => {
      expect(variationManager.getVariationIndex('Classic')).toBe(0);
      expect(variationManager.getVariationIndex('Fractal')).toBe(5);
      expect(variationManager.getVariationIndex('Maximal')).toBe(9);
    });

    it('should return -1 for invalid variation name', () => {
      expect(variationManager.getVariationIndex('NonExistent')).toBe(-1);
    });
  });

  describe('Preset Validation', () => {
    it('should have valid parameter ranges for all presets', () => {
      for (let i = 0; i < 10; i++) {
        const preset = variationManager.getVariationPreset(i);

        // Check all values are numbers
        expect(typeof preset.rotationSpeed).toBe('number');
        expect(typeof preset.complexity).toBe('number');
        expect(typeof preset.colorIntensity).toBe('number');

        // Check reasonable ranges
        expect(preset.rotationSpeed).toBeGreaterThanOrEqual(0);
        expect(preset.rotationSpeed).toBeLessThanOrEqual(1);
        expect(preset.complexity).toBeGreaterThanOrEqual(0);
        expect(preset.complexity).toBeLessThanOrEqual(1);
      }
    });

    it('should have unique presets for each variation', () => {
      const presets = [];
      for (let i = 0; i < 10; i++) {
        presets.push(variationManager.getVariationPreset(i));
      }

      // Check that not all presets are identical
      const allSame = presets.every(preset =>
        preset.rotationSpeed === presets[0].rotationSpeed &&
        preset.complexity === presets[0].complexity
      );

      expect(allSame).toBe(false);
    });
  });

  describe('Variation Characteristics', () => {
    it('should have Minimal with low complexity', () => {
      const preset = variationManager.getVariationPreset(8); // Minimal
      expect(preset.complexity).toBeLessThan(0.3);
    });

    it('should have Maximal with high complexity', () => {
      const preset = variationManager.getVariationPreset(9); // Maximal
      expect(preset.complexity).toBeGreaterThan(0.8);
    });

    it('should have Classic with balanced parameters', () => {
      const preset = variationManager.getVariationPreset(0); // Classic
      expect(preset.complexity).toBeGreaterThan(0.3);
      expect(preset.complexity).toBeLessThan(0.7);
    });

    it('should have Fractal with extreme complexity', () => {
      const preset = variationManager.getVariationPreset(5); // Fractal
      expect(preset.complexity).toBeGreaterThan(0.7);
    });
  });

  describe('All Variations Access', () => {
    it('should get all variation names', () => {
      const names = variationManager.getAllVariationNames();
      expect(names).toHaveLength(10);
      expect(names).toContain('Classic');
      expect(names).toContain('Quantum');
    });

    it('should get variation count', () => {
      const count = variationManager.getVariationCount();
      expect(count).toBe(10);
    });
  });
});
