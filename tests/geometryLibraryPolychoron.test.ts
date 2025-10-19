import { describe, expect, it } from 'vitest';

import { GeometryLibrary } from '../src/geometry/GeometryLibrary.js';

describe('GeometryLibrary polychora catalog', () => {
  it('lists canonical polychoron identifiers', () => {
    const names = GeometryLibrary.listPolychora();
    expect(names).toContain('5-cell');
    expect(names).toContain('tesseract');
    expect(names).toContain('600-cell');
  });

  it('provides vertex and edge buffers for generated polychora', () => {
    const tesseractVertices = GeometryLibrary.createPolychoronVertexBuffer('tesseract');
    expect(tesseractVertices).not.toBeNull();
    expect(tesseractVertices?.length).toBe(16 * 4);

    const edgeIndex = GeometryLibrary.getPolychoronEdgeIndexBuffer('tesseract');
    expect(edgeIndex).not.toBeNull();
    expect(edgeIndex?.length).toBe(32 * 2);
  });

  it('returns metadata for catalogued polychora without geometry payloads', () => {
    const metadata = GeometryLibrary.getPolychoronMetadata('120-cell');
    expect(metadata).not.toBeNull();
    expect(metadata?.cells).toBe(120);
    expect(metadata?.dual).toBe('600-cell');
  });

  it('supports cross polytope edge generation', () => {
    const edges = GeometryLibrary.getPolychoronEdgeIndexBuffer('16-cell');
    expect(edges).not.toBeNull();
    expect(edges?.length).toBe(24 * 2);
  });
});
