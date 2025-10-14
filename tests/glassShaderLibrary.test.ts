import { describe, expect, it } from 'vitest';
import { buildGlassLayerShader } from '../src/ui/adaptive/renderers/webgpu/GlassShaderLibrary.ts';

describe('buildGlassLayerShader', () => {
  it('emits WGSL with lattice function for the selected geometry', () => {
    const code = buildGlassLayerShader({ geometry: 'hypercube', projection: 'perspective' });
    expect(code).toContain('fn calculateLattice');
    expect(code).toContain('rotXW');
    expect(code).toContain('GlassUniforms');
  });

  it('switches projection snippets based on requested projection', () => {
    const perspective = buildGlassLayerShader({ geometry: 'hypersphere', projection: 'perspective' });
    const orthographic = buildGlassLayerShader({ geometry: 'hypersphere', projection: 'orthographic' });
    expect(perspective).not.toEqual(orthographic);
    expect(orthographic).toContain('mix(ortho, perspective, morph');
  });
});
