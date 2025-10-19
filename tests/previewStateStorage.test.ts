import { describe, expect, it } from 'vitest';

import {
  PREVIEW_STORAGE_KEY,
  PREVIEW_STORAGE_VERSION,
  DEFAULT_PREVIEW_ROTOR_STATE,
  createPreviewStateStorage,
  parsePreviewState,
  sanitizePreviewRotorState,
  stringifyPreviewState,
  type PreviewStatePayload,
  type StorageLike,
} from '../src/dev/previewStateStorage.ts';

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

describe('previewStateStorage', () => {
  const sampleState: PreviewStatePayload = {
    version: PREVIEW_STORAGE_VERSION,
    activePresetId: 'baseline',
    activeSystemId: 'quantum',
    yaw: 10,
    pitch: -5,
    roll: 22,
    confidence: 0.85,
    selectedGeometry: 'hypersphere',
    selectedProjection: 'perspective',
    layers: [
      {
        geometry: 'hypersphere',
        projection: 'perspective',
        material: {
          primaryColor: '#FF00FF',
          secondaryColor: '#00FFFF',
          backgroundColor: '#000000',
          patternIntensity: 1,
          glitchIntensity: 0.2,
          colorShift: 0.1,
          gridDensity: 8,
          lineThickness: 0.02,
          shellWidth: 0.03,
          tetraThickness: 0.04,
        },
      },
    ],
    rotor: {
      xy: 0.5,
      xz: -0.25,
      yz: 0.1,
      xw: 0.9,
      yw: -0.4,
      zw: 0.32,
    },
  };

  it('returns null when storage is unavailable', () => {
    expect(createPreviewStateStorage(null)).toBeNull();
  });

  it('persists and reloads preview state payloads', () => {
    const memory = new MemoryStorage();
    const storage = createPreviewStateStorage(memory);
    expect(storage).not.toBeNull();

    storage!.save(sampleState);

    const raw = memory.getItem(PREVIEW_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const loaded = storage!.load();
    expect(loaded).toEqual(sampleState);
  });

  it('returns null when stored data is invalid JSON', () => {
    const memory = new MemoryStorage();
    const storage = createPreviewStateStorage(memory)!;
    memory.setItem(PREVIEW_STORAGE_KEY, '{"invalid":');

    expect(storage.load()).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const memory = new MemoryStorage();
    const storage = createPreviewStateStorage(memory)!;
    memory.setItem(
      PREVIEW_STORAGE_KEY,
      JSON.stringify({
        version: PREVIEW_STORAGE_VERSION,
        activePresetId: 'baseline',
      })
    );

    expect(storage.load()).toBeNull();
  });

  it('clears persisted data', () => {
    const memory = new MemoryStorage();
    const storage = createPreviewStateStorage(memory)!;
    storage.save(sampleState);

    storage.clear();
    expect(memory.getItem(PREVIEW_STORAGE_KEY)).toBeNull();
  });

  it('stringifies preview states with optional pretty formatting', () => {
    const compact = stringifyPreviewState(sampleState);
    expect(compact).toBe(JSON.stringify(sampleState));

    const pretty = stringifyPreviewState(sampleState, true);
    expect(pretty.includes('\n')).toBe(true);
    expect(pretty.trim().startsWith('{')).toBe(true);
  });

  it('parses preview states and rejects invalid payloads', () => {
    const serialized = stringifyPreviewState(sampleState);
    expect(parsePreviewState(serialized)).toEqual(sampleState);
    expect(parsePreviewState('')).toBeNull();
    expect(parsePreviewState('{"version":0}')).toBeNull();
  });

  it('upgrades legacy payloads that omit rotor fields', () => {
    const legacyState = {
      ...sampleState,
      rotor: undefined,
    } as unknown as PreviewStatePayload;
    const serialized = JSON.stringify(legacyState);
    const parsed = parsePreviewState(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed?.rotor).toEqual(DEFAULT_PREVIEW_ROTOR_STATE);
  });

  it('sanitizes rotor payloads when stringifying', () => {
    const dirtyState = {
      ...sampleState,
      rotor: sanitizePreviewRotorState({ xy: '1.2' as unknown as number }),
    };
    const serialized = stringifyPreviewState(dirtyState);
    expect(serialized).toContain('"xy":1.2');
  });
});
