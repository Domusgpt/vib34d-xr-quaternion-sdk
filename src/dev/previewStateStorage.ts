export const PREVIEW_STORAGE_KEY = 'vib3d.quaternionPreview.state';
export const PREVIEW_STORAGE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PreviewLayerMaterialPayload {
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

export interface PreviewLayerStatePayload {
  geometry: string;
  projection: string;
  material: PreviewLayerMaterialPayload;
}

export interface PreviewStatePayload {
  version: number;
  activePresetId: string;
  activeSystemId: string;
  yaw: number;
  pitch: number;
  roll: number;
  confidence: number;
  selectedGeometry: string;
  selectedProjection: string;
  layers: PreviewLayerStatePayload[];
}

export interface PreviewStateStorage {
  load(): PreviewStatePayload | null;
  save(state: PreviewStatePayload): void;
  clear(): void;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isLayerMaterialPayload = (value: unknown): value is PreviewLayerMaterialPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PreviewLayerMaterialPayload>;
  return (
    typeof candidate.primaryColor === 'string' &&
    typeof candidate.secondaryColor === 'string' &&
    typeof candidate.backgroundColor === 'string' &&
    isFiniteNumber(candidate.patternIntensity) &&
    isFiniteNumber(candidate.glitchIntensity) &&
    isFiniteNumber(candidate.colorShift) &&
    isFiniteNumber(candidate.gridDensity) &&
    isFiniteNumber(candidate.lineThickness) &&
    isFiniteNumber(candidate.shellWidth) &&
    isFiniteNumber(candidate.tetraThickness)
  );
};

const isLayerStatePayload = (value: unknown): value is PreviewLayerStatePayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PreviewLayerStatePayload>;
  return (
    typeof candidate.geometry === 'string' &&
    typeof candidate.projection === 'string' &&
    isLayerMaterialPayload(candidate.material)
  );
};

const isPreviewStatePayload = (value: unknown): value is PreviewStatePayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PreviewStatePayload>;
  return (
    candidate.version === PREVIEW_STORAGE_VERSION &&
    typeof candidate.activePresetId === 'string' &&
    typeof candidate.activeSystemId === 'string' &&
    isFiniteNumber(candidate.yaw) &&
    isFiniteNumber(candidate.pitch) &&
    isFiniteNumber(candidate.roll) &&
    isFiniteNumber(candidate.confidence) &&
    typeof candidate.selectedGeometry === 'string' &&
    typeof candidate.selectedProjection === 'string' &&
    Array.isArray(candidate.layers) &&
    candidate.layers.every(isLayerStatePayload)
  );
};

export const parsePreviewState = (raw: string): PreviewStatePayload | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isPreviewStatePayload(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[QuaternionPreview] Failed to parse preview state', error);
    return null;
  }
};

export const stringifyPreviewState = (
  state: PreviewStatePayload,
  pretty: boolean = false
) => JSON.stringify(state, null, pretty ? 2 : undefined);

export const createPreviewStateStorage = (
  storage: StorageLike | null | undefined =
    typeof window !== 'undefined' ? window.localStorage : null
): PreviewStateStorage | null => {
  if (!storage) {
    return null;
  }

  return {
    load() {
      const raw = storage.getItem(PREVIEW_STORAGE_KEY);
      return raw ? parsePreviewState(raw) : null;
    },
    save(state) {
      try {
        storage.setItem(PREVIEW_STORAGE_KEY, stringifyPreviewState(state));
      } catch (error) {
        console.warn('[QuaternionPreview] Failed to persist preview state', error);
      }
    },
    clear() {
      try {
        storage.removeItem(PREVIEW_STORAGE_KEY);
      } catch (error) {
        console.warn('[QuaternionPreview] Failed to clear preview state', error);
      }
    }
  };
};
