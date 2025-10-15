import type {
  GlassGeometryModule,
  GlassProjectionModule,
} from '../ui/adaptive/renderers/webgpu/GlassShaderLibrary.ts';

export interface PreviewLayerMaterial {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  patternIntensity: number;
  glitchIntensity: number;
  colorShift: number;
  gridDensity: number;
  lineThickness: number;
  shellWidth: number;
  tetraThickness: number;
}

export interface PreviewLayerSnapshot {
  geometry: GlassGeometryModule;
  projection: GlassProjectionModule;
  material: PreviewLayerMaterial;
}

export interface PreviewSnapshot {
  version: number;
  geometry: GlassGeometryModule;
  projection: GlassProjectionModule;
  angles: {
    yaw: number;
    pitch: number;
    roll: number;
  };
  confidence: number;
  layers: PreviewLayerSnapshot[];
}

export interface SnapshotDefaults {
  geometry: GlassGeometryModule;
  projection: GlassProjectionModule;
  angles: {
    yaw: number;
    pitch: number;
    roll: number;
  };
  confidence: number;
  layers: readonly PreviewLayerSnapshot[];
}

export const PREVIEW_SNAPSHOT_VERSION = 1;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const geometryValues: readonly GlassGeometryModule[] = [
  'hypercube',
  'hypersphere',
  'hypertetrahedron',
];

const projectionValues: readonly GlassProjectionModule[] = [
  'perspective',
  'orthographic',
  'stereographic',
];

const isGeometry = (value: unknown): value is GlassGeometryModule =>
  geometryValues.includes(value as GlassGeometryModule);

const isProjection = (value: unknown): value is GlassProjectionModule =>
  projectionValues.includes(value as GlassProjectionModule);

const normalizeColor = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback.toUpperCase();
  }
  const sanitized = value.trim().replace(/^#/u, '');
  if (!/^([0-9A-Fa-f]{6})$/u.test(sanitized)) {
    return fallback.toUpperCase();
  }
  return `#${sanitized.toUpperCase()}`;
};

const normalizeNumber = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  if (!isFiniteNumber(value)) {
    return clamp(fallback, min, max);
  }
  return clamp(value, min, max);
};

const normalizeMaterial = (
  value: unknown,
  fallback: PreviewLayerMaterial,
): PreviewLayerMaterial => {
  if (!isObject(value)) {
    return { ...fallback };
  }

  return {
    primaryColor: normalizeColor(
      value.primaryColor,
      fallback.primaryColor,
    ),
    secondaryColor: normalizeColor(
      value.secondaryColor,
      fallback.secondaryColor,
    ),
    backgroundColor: normalizeColor(
      value.backgroundColor,
      fallback.backgroundColor,
    ),
    patternIntensity: normalizeNumber(
      value.patternIntensity,
      0,
      5,
      fallback.patternIntensity,
    ),
    glitchIntensity: normalizeNumber(
      value.glitchIntensity,
      0,
      1,
      fallback.glitchIntensity,
    ),
    colorShift: normalizeNumber(
      value.colorShift,
      -1,
      1,
      fallback.colorShift,
    ),
    gridDensity: normalizeNumber(
      value.gridDensity,
      0.5,
      64,
      fallback.gridDensity,
    ),
    lineThickness: normalizeNumber(
      value.lineThickness,
      0.0001,
      1,
      fallback.lineThickness,
    ),
    shellWidth: normalizeNumber(
      value.shellWidth,
      0.0001,
      1,
      fallback.shellWidth,
    ),
    tetraThickness: normalizeNumber(
      value.tetraThickness,
      0.0001,
      1,
      fallback.tetraThickness,
    ),
  };
};

const cloneLayer = (layer: PreviewLayerSnapshot): PreviewLayerSnapshot => ({
  geometry: layer.geometry,
  projection: layer.projection,
  material: { ...layer.material },
});

export const parsePreviewSnapshot = (
  input: unknown,
  defaults: SnapshotDefaults,
): PreviewSnapshot | null => {
  if (!defaults.layers.length) {
    return null;
  }

  if (!isObject(input)) {
    return null;
  }

  const version = isFiniteNumber(input.version)
    ? input.version
    : PREVIEW_SNAPSHOT_VERSION;

  const geometry = isGeometry(input.geometry)
    ? (input.geometry as GlassGeometryModule)
    : defaults.geometry;

  const projection = isProjection(input.projection)
    ? (input.projection as GlassProjectionModule)
    : defaults.projection;

  const rawAngles = isObject(input.angles) ? input.angles : {};

  const angles = {
    yaw: normalizeNumber(rawAngles.yaw, -360, 360, defaults.angles.yaw),
    pitch: normalizeNumber(rawAngles.pitch, -180, 180, defaults.angles.pitch),
    roll: normalizeNumber(rawAngles.roll, -360, 360, defaults.angles.roll),
  } as const;

  const confidence = normalizeNumber(
    input.confidence,
    0,
    1,
    defaults.confidence,
  );

  const rawLayers = Array.isArray(input.layers) ? input.layers : [];

  const layers = defaults.layers.map((fallbackLayer, index) => {
    const rawLayer = rawLayers[index];
    if (!isObject(rawLayer)) {
      return cloneLayer(fallbackLayer);
    }
    const geometryValue = isGeometry(rawLayer.geometry)
      ? (rawLayer.geometry as GlassGeometryModule)
      : fallbackLayer.geometry;
    const projectionValue = isProjection(rawLayer.projection)
      ? (rawLayer.projection as GlassProjectionModule)
      : fallbackLayer.projection;
    const materialValue = normalizeMaterial(
      rawLayer.material,
      fallbackLayer.material,
    );
    return {
      geometry: geometryValue,
      projection: projectionValue,
      material: materialValue,
    } satisfies PreviewLayerSnapshot;
  });

  return {
    version,
    geometry,
    projection,
    angles,
    confidence,
    layers,
  } satisfies PreviewSnapshot;
};
