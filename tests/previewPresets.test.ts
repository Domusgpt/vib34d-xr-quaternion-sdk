import { describe, expect, it } from 'vitest';

import { PREVIEW_PRESETS, findPreviewPreset } from '../src/dev/previewPresets.ts';

const geometryModules = new Set(['hypercube', 'hypersphere', 'hypertetrahedron']);
const projectionModules = new Set(['perspective', 'orthographic', 'stereographic']);
const colorPattern = /^#[0-9A-F]{6}$/;

describe('preview preset library', () => {
  it('exposes unique preset identifiers with helpful descriptions', () => {
    expect(PREVIEW_PRESETS.length).toBeGreaterThanOrEqual(3);

    const ids = PREVIEW_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);

    PREVIEW_PRESETS.forEach(preset => {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(findPreviewPreset(preset.id)).toBe(preset);
    });
  });

  it('keeps all preset layers within expected geometry and parameter ranges', () => {
    PREVIEW_PRESETS.forEach(preset => {
      expect(preset.layers.length).toBe(5);

      preset.layers.forEach(layer => {
        expect(geometryModules.has(layer.geometry)).toBe(true);
        expect(projectionModules.has(layer.projection)).toBe(true);

        const material = layer.material;
        expect(colorPattern.test(material.primaryColor)).toBe(true);
        expect(colorPattern.test(material.secondaryColor)).toBe(true);
        expect(colorPattern.test(material.backgroundColor)).toBe(true);

        expect(material.patternIntensity).toBeGreaterThanOrEqual(0);
        expect(material.patternIntensity).toBeLessThanOrEqual(2);
        expect(material.glitchIntensity).toBeGreaterThanOrEqual(0);
        expect(material.glitchIntensity).toBeLessThanOrEqual(1);
        expect(material.colorShift).toBeGreaterThanOrEqual(-1);
        expect(material.colorShift).toBeLessThanOrEqual(1);

        expect(material.gridDensity).toBeGreaterThanOrEqual(2);
        expect(material.gridDensity).toBeLessThanOrEqual(18);
        expect(material.lineThickness).toBeGreaterThanOrEqual(0.005);
        expect(material.lineThickness).toBeLessThanOrEqual(0.08);
        expect(material.shellWidth).toBeGreaterThanOrEqual(0.005);
        expect(material.shellWidth).toBeLessThanOrEqual(0.08);
        expect(material.tetraThickness).toBeGreaterThanOrEqual(0.005);
        expect(material.tetraThickness).toBeLessThanOrEqual(0.08);
      });
    });
  });
});
