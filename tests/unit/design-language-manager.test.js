/**
 * Tests for DesignLanguageManager
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DesignLanguageManager } from '../../src/features/DesignLanguageManager.js';

describe('DesignLanguageManager', () => {
  let manager;
  let mockEngine;

  beforeEach(() => {
    mockEngine = {
      parameterManager: {
        setParameter: () => {},
        getParameter: () => {}
      }
    };

    manager = new DesignLanguageManager(mockEngine, {
      defaultLanguage: 'default'
    });
  });

  describe('Initialization', () => {
    it('should create manager with engine reference', () => {
      expect(manager.engine).toBe(mockEngine);
    });

    it('should initialize design specifications', () => {
      expect(manager.designSpecs).toBeDefined();
      expect(Object.keys(manager.designSpecs).length).toBe(10);
    });

    it('should initialize pattern library', () => {
      expect(manager.patternLibrary).toBeInstanceOf(Map);
      expect(manager.patternLibrary.size).toBeGreaterThan(0);
    });

    it('should set default language', () => {
      expect(manager.activeLanguage).toBe('default');
    });

    it('should initialize with custom options', () => {
      const customManager = new DesignLanguageManager(mockEngine, {
        defaultLanguage: 'custom'
      });
      expect(customManager.activeLanguage).toBe('custom');
    });
  });

  describe('Design Specifications', () => {
    it('should have design specs for all 10 variations', () => {
      const expectedVariations = [
        'Classic', 'Ethereal', 'Geometric', 'Organic', 'Crystalline',
        'Fractal', 'Holographic', 'Quantum', 'Minimal', 'Maximal'
      ];

      expectedVariations.forEach(variation => {
        expect(manager.designSpecs).toHaveProperty(variation);
      });
    });

    it('should get design spec by variation name', () => {
      const spec = manager.getDesignSpec('Classic');
      expect(spec).toBeDefined();
      expect(spec).toHaveProperty('pattern');
      expect(spec).toHaveProperty('monetization');
      expect(spec).toHaveProperty('typography');
      expect(spec).toHaveProperty('layout');
    });

    it('should return default spec for invalid variation', () => {
      const spec = manager.getDesignSpec('NonExistent');
      expect(spec).toBeDefined();
      expect(spec).toBe(manager.designSpecs['Classic']);
    });

    it('should have complete pattern information', () => {
      const spec = manager.getDesignSpec('Geometric');
      expect(spec.pattern).toHaveProperty('id');
      expect(spec.pattern).toHaveProperty('name');
      expect(spec.pattern).toHaveProperty('complexity');
      expect(spec.pattern).toHaveProperty('style');
      expect(spec.pattern).toHaveProperty('colorScheme');
      expect(spec.pattern).toHaveProperty('animation');
    });

    it('should have monetization tier information', () => {
      const spec = manager.getDesignSpec('Premium');
      expect(spec.monetization).toHaveProperty('tier');
      expect(spec.monetization).toHaveProperty('features');
      expect(spec.monetization).toHaveProperty('restrictions');
    });

    it('should have typography specifications', () => {
      const spec = manager.getDesignSpec('Minimal');
      expect(spec.typography).toHaveProperty('scale');
      expect(spec.typography).toHaveProperty('weight');
      expect(spec.typography).toHaveProperty('spacing');
    });

    it('should have layout specifications', () => {
      const spec = manager.getDesignSpec('Maximal');
      expect(spec.layout).toHaveProperty('grid');
      expect(spec.layout).toHaveProperty('spacing');
      expect(spec.layout).toHaveProperty('density');
    });
  });

  describe('Monetization Tiers', () => {
    it('should have free tier variations', () => {
      const freeDesigns = manager.getDesignsByTier('free');
      expect(freeDesigns.length).toBeGreaterThan(0);
    });

    it('should have premium tier variations', () => {
      const premiumDesigns = manager.getDesignsByTier('premium');
      expect(premiumDesigns.length).toBeGreaterThan(0);
    });

    it('should have enterprise tier variations', () => {
      const enterpriseDesigns = manager.getDesignsByTier('enterprise');
      expect(enterpriseDesigns.length).toBeGreaterThan(0);
    });

    it('should categorize Classic as free tier', () => {
      const spec = manager.getDesignSpec('Classic');
      expect(spec.monetization.tier).toBe('free');
    });

    it('should categorize Geometric as premium tier', () => {
      const spec = manager.getDesignSpec('Geometric');
      expect(spec.monetization.tier).toBe('premium');
    });

    it('should categorize Crystalline as enterprise tier', () => {
      const spec = manager.getDesignSpec('Crystalline');
      expect(spec.monetization.tier).toBe('enterprise');
    });

    it('should categorize Quantum as research tier', () => {
      const spec = manager.getDesignSpec('Quantum');
      expect(spec.monetization.tier).toBe('research');
    });

    it('should have restrictions for research tier', () => {
      const spec = manager.getDesignSpec('Quantum');
      expect(spec.monetization.restrictions).toContain('research-license-required');
    });
  });

  describe('Pattern Library', () => {
    it('should have patterns for core designs', () => {
      expect(manager.patternLibrary.has('classic-balanced')).toBe(true);
      expect(manager.patternLibrary.has('geometric-precise')).toBe(true);
      expect(manager.patternLibrary.has('fractal-recursive')).toBe(true);
    });

    it('should have geometry specifications in patterns', () => {
      const pattern = manager.patternLibrary.get('classic-balanced');
      expect(pattern).toHaveProperty('geometry');
      expect(pattern).toHaveProperty('rotation');
      expect(pattern).toHaveProperty('projection');
    });

    it('should have tesseract geometry for Classic', () => {
      const pattern = manager.patternLibrary.get('classic-balanced');
      expect(pattern.geometry).toBe('tesseract');
    });

    it('should have 24-cell geometry for Geometric', () => {
      const pattern = manager.patternLibrary.get('geometric-precise');
      expect(pattern.geometry).toBe('24-cell');
    });

    it('should have 120-cell geometry for Crystalline', () => {
      const pattern = manager.patternLibrary.get('crystalline-faceted');
      expect(pattern.geometry).toBe('120-cell');
    });
  });

  describe('Feature Availability', () => {
    it('should check if feature is available in variation', () => {
      const available = manager.isFeatureAvailable('Geometric', 'geometric-patterns');
      expect(available).toBe(true);
    });

    it('should return false for unavailable features', () => {
      const available = manager.isFeatureAvailable('Classic', 'quantum-patterns');
      expect(available).toBe(false);
    });

    it('should validate premium features', () => {
      const available = manager.isFeatureAvailable('Holographic', 'holographic-effects');
      expect(available).toBe(true);
    });

    it('should validate enterprise features', () => {
      const available = manager.isFeatureAvailable('Maximal', 'custom-shaders');
      expect(available).toBe(true);
    });
  });

  describe('Marketplace Catalog Export', () => {
    it('should export marketplace catalog', () => {
      const catalog = manager.exportMarketplaceCatalog();
      expect(catalog).toBeDefined();
      expect(catalog).toHaveProperty('version');
      expect(catalog).toHaveProperty('timestamp');
      expect(catalog).toHaveProperty('designs');
      expect(catalog).toHaveProperty('categories');
    });

    it('should have catalog version', () => {
      const catalog = manager.exportMarketplaceCatalog();
      expect(catalog.version).toBe('1.0.0');
    });

    it('should include all 10 designs in catalog', () => {
      const catalog = manager.exportMarketplaceCatalog();
      expect(catalog.designs).toHaveLength(10);
      expect(catalog.totalDesigns).toBe(10);
    });

    it('should categorize designs by tier', () => {
      const catalog = manager.exportMarketplaceCatalog();
      expect(catalog.categories).toHaveProperty('free');
      expect(catalog.categories).toHaveProperty('premium');
      expect(catalog.categories).toHaveProperty('enterprise');
      expect(catalog.categories).toHaveProperty('research');
    });

    it('should have design entries with required fields', () => {
      const catalog = manager.exportMarketplaceCatalog();
      const design = catalog.designs[0];

      expect(design).toHaveProperty('id');
      expect(design).toHaveProperty('name');
      expect(design).toHaveProperty('displayName');
      expect(design).toHaveProperty('tier');
      expect(design).toHaveProperty('complexity');
      expect(design).toHaveProperty('style');
      expect(design).toHaveProperty('features');
      expect(design).toHaveProperty('preview');
    });

    it('should include pattern preview in catalog', () => {
      const catalog = manager.exportMarketplaceCatalog();
      const design = catalog.designs.find(d => d.name === 'Classic');

      expect(design.preview).toHaveProperty('pattern');
      expect(design.preview).toHaveProperty('typography');
      expect(design.preview).toHaveProperty('layout');
    });

    it('should list available tiers', () => {
      const catalog = manager.exportMarketplaceCatalog();
      expect(catalog.availableTiers).toContain('free');
      expect(catalog.availableTiers).toContain('premium');
      expect(catalog.availableTiers).toContain('enterprise');
    });

    it('should have timestamp in ISO format', () => {
      const catalog = manager.exportMarketplaceCatalog();
      const timestamp = new Date(catalog.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Complexity Levels', () => {
    it('should have Minimal with very-low complexity', () => {
      const spec = manager.getDesignSpec('Minimal');
      expect(spec.pattern.complexity).toBe('very-low');
    });

    it('should have Classic with medium complexity', () => {
      const spec = manager.getDesignSpec('Classic');
      expect(spec.pattern.complexity).toBe('medium');
    });

    it('should have Fractal with extreme complexity', () => {
      const spec = manager.getDesignSpec('Fractal');
      expect(spec.pattern.complexity).toBe('extreme');
    });

    it('should have Quantum with extreme complexity', () => {
      const spec = manager.getDesignSpec('Quantum');
      expect(spec.pattern.complexity).toBe('extreme');
    });

    it('should have varied complexity across designs', () => {
      const complexities = Object.values(manager.designSpecs).map(
        spec => spec.pattern.complexity
      );
      const uniqueComplexities = new Set(complexities);
      expect(uniqueComplexities.size).toBeGreaterThan(3);
    });
  });

  describe('Custom Design Registration', () => {
    it('should register custom design specification', () => {
      const customSpec = {
        pattern: {
          id: 'custom-design',
          name: 'Custom Design',
          complexity: 'medium',
          style: 'custom',
          colorScheme: 'custom-colors',
          animation: 'custom-anim'
        },
        monetization: {
          tier: 'premium',
          features: ['custom-features'],
          restrictions: []
        },
        typography: {
          scale: 1.0,
          weight: 'normal',
          spacing: 'standard'
        },
        layout: {
          grid: 'custom-grid',
          spacing: 'medium',
          density: 'balanced'
        }
      };

      manager.registerDesignSpec('Custom', customSpec);
      const retrieved = manager.getDesignSpec('Custom');
      expect(retrieved).toEqual(customSpec);
    });

    it('should allow overriding existing designs', () => {
      const newClassicSpec = {
        pattern: { id: 'new-classic' },
        monetization: { tier: 'free', features: [], restrictions: [] },
        typography: { scale: 1.0, weight: 'normal', spacing: 'standard' },
        layout: { grid: 'new-grid', spacing: 'medium', density: 'balanced' }
      };

      manager.registerDesignSpec('Classic', newClassicSpec);
      const retrieved = manager.getDesignSpec('Classic');
      expect(retrieved.pattern.id).toBe('new-classic');
    });
  });

  describe('Design Language Registration', () => {
    it('should register design language', () => {
      const languageSpec = { theme: 'dark', colors: {} };
      manager.register('dark-theme', languageSpec);

      expect(manager.languages.has('dark-theme')).toBe(true);
    });

    it('should apply design language', () => {
      const languageSpec = { theme: 'dark' };
      manager.register('dark-theme', languageSpec);

      const result = manager.apply('dark-theme');
      expect(result).toBe(true);
      expect(manager.activeLanguage).toBe('dark-theme');
    });

    it('should return false for non-existent language', () => {
      const result = manager.apply('non-existent');
      expect(result).toBe(false);
    });

    it('should get current language', () => {
      const languageSpec = { theme: 'light' };
      manager.register('light-theme', languageSpec);
      manager.apply('light-theme');

      const current = manager.getCurrent();
      expect(current).toEqual(languageSpec);
    });
  });

  describe('Available Variations', () => {
    it('should get all available variation names', () => {
      const variations = manager.getAvailableVariations();
      expect(variations).toHaveLength(10);
      expect(variations).toContain('Classic');
      expect(variations).toContain('Quantum');
      expect(variations).toContain('Maximal');
    });

    it('should return array of strings', () => {
      const variations = manager.getAvailableVariations();
      variations.forEach(name => {
        expect(typeof name).toBe('string');
      });
    });
  });

  describe('Design Styles', () => {
    it('should have unique style for each design', () => {
      const styles = Object.values(manager.designSpecs).map(
        spec => spec.pattern.style
      );
      const uniqueStyles = new Set(styles);
      expect(uniqueStyles.size).toBeGreaterThan(5);
    });

    it('should have appropriate style for Geometric', () => {
      const spec = manager.getDesignSpec('Geometric');
      expect(spec.pattern.style).toBe('angular');
    });

    it('should have appropriate style for Organic', () => {
      const spec = manager.getDesignSpec('Organic');
      expect(spec.pattern.style).toBe('natural');
    });

    it('should have appropriate style for Holographic', () => {
      const spec = manager.getDesignSpec('Holographic');
      expect(spec.pattern.style).toBe('holographic');
    });
  });

  describe('Color Schemes', () => {
    it('should have diverse color schemes', () => {
      const colorSchemes = Object.values(manager.designSpecs).map(
        spec => spec.pattern.colorScheme
      );
      const uniqueSchemes = new Set(colorSchemes);
      expect(uniqueSchemes.size).toBeGreaterThan(5);
    });

    it('should have monochrome for Minimal', () => {
      const spec = manager.getDesignSpec('Minimal');
      expect(spec.pattern.colorScheme).toBe('monochrome');
    });

    it('should have iridescent for Holographic', () => {
      const spec = manager.getDesignSpec('Holographic');
      expect(spec.pattern.colorScheme).toBe('iridescent');
    });

    it('should have prismatic for Crystalline', () => {
      const spec = manager.getDesignSpec('Crystalline');
      expect(spec.pattern.colorScheme).toBe('prismatic');
    });
  });
});
