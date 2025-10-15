import { describe, expect, it } from 'vitest';

import {
  PREVIEW_SNAPSHOT_VERSION,
  parsePreviewSnapshot,
  type PreviewLayerSnapshot,
  type SnapshotDefaults,
} from '../src/dev/previewState.ts';

const baseMaterial = {
  primaryColor: '#FF00FF',
  secondaryColor: '#00FFFF',
  backgroundColor: '#000000',
  patternIntensity: 1,
  glitchIntensity: 0.1,
  colorShift: 0,
  gridDensity: 8,
  lineThickness: 0.02,
  shellWidth: 0.02,
  tetraThickness: 0.03,
} as const;

const defaultLayers: PreviewLayerSnapshot[] = [
  {
    geometry: 'hypersphere',
    projection: 'perspective',
    material: { ...baseMaterial },
  },
  {
    geometry: 'hypercube',
    projection: 'orthographic',
    material: { ...baseMaterial, gridDensity: 6, primaryColor: '#AA33FF' },
  },
];

const defaults: SnapshotDefaults = {
  geometry: 'hypersphere',
  projection: 'perspective',
  angles: { yaw: 20, pitch: 10, roll: -12 },
  confidence: 0.85,
  layers: defaultLayers,
};

describe('parsePreviewSnapshot', () => {
  it('returns null for non-object input', () => {
    expect(parsePreviewSnapshot(null, defaults)).toBeNull();
    expect(parsePreviewSnapshot('not-json', defaults)).toBeNull();
  });

  it('normalizes snapshot values and applies defaults for invalid data', () => {
    const snapshot = parsePreviewSnapshot(
      {
        version: PREVIEW_SNAPSHOT_VERSION + 2,
        geometry: 'invalid-geo',
        projection: 'orthographic',
        angles: { yaw: 720, pitch: 200, roll: -540 },
        confidence: 4,
        layers: [
          {
            geometry: 'invalid',
            projection: 'perspective',
            material: {
              primaryColor: '12abcf',
              secondaryColor: '#GG00FF',
              backgroundColor: '#101010',
              patternIntensity: -4,
              glitchIntensity: 3,
              colorShift: 2,
              gridDensity: -5,
              lineThickness: 2,
              shellWidth: 3,
              tetraThickness: 4,
            },
          },
        ],
      },
      defaults,
    );

    expect(snapshot).not.toBeNull();
    const value = snapshot!;
    expect(value.version).toBe(PREVIEW_SNAPSHOT_VERSION + 2);
    expect(value.geometry).toBe(defaults.geometry);
    expect(value.projection).toBe('orthographic');
    expect(value.angles).toEqual({ yaw: 360, pitch: 180, roll: -360 });
    expect(value.confidence).toBe(1);
    expect(value.layers).toHaveLength(defaultLayers.length);

    const [firstLayer, secondLayer] = value.layers;
    expect(firstLayer.geometry).toBe(defaults.layers[0].geometry);
    expect(firstLayer.projection).toBe('perspective');
    expect(firstLayer.material.primaryColor).toBe('#12ABCF');
    expect(firstLayer.material.secondaryColor).toBe(defaults.layers[0].material.secondaryColor);
    expect(firstLayer.material.patternIntensity).toBe(0);
    expect(firstLayer.material.glitchIntensity).toBe(1);
    expect(firstLayer.material.colorShift).toBe(1);
    expect(firstLayer.material.gridDensity).toBe(0.5);
    expect(firstLayer.material.lineThickness).toBe(1);
    expect(firstLayer.material.shellWidth).toBe(1);
    expect(firstLayer.material.tetraThickness).toBe(1);

    expect(secondLayer).toEqual(defaultLayers[1]);
  });
});
