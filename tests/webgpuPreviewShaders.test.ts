import { describe, expect, it } from 'vitest';
import { createCompositeShaderSource } from '../src/dev/webgpuGlassPreview.ts';

describe('createCompositeShaderSource', () => {
  it('generates sampler and texture bindings for each layer', () => {
    const source = createCompositeShaderSource(3);
    expect(source).toContain('@binding(0) var linearSampler');
    expect(source).toContain('@binding(1) var layer0');
    expect(source).toContain('@binding(3) var layer2');
    expect(source).toMatch(/pow\(color\.rgb/);
  });

  it('throws for invalid layer counts', () => {
    expect(() => createCompositeShaderSource(0)).toThrow(/layerCount/i);
    expect(() => createCompositeShaderSource(-2)).toThrow(/layerCount/i);
  });
});
