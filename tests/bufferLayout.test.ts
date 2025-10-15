import { describe, expect, it } from 'vitest';
import {
  createStd140Layout,
  createStd430Layout,
  createFloat32ArrayForLayout,
  writeField,
  readField,
} from '../src/ui/adaptive/renderers/webgpu/BufferLayout.ts';

describe('BufferLayout', () => {
  it('computes std140 offsets with vec3 padding and array stride', () => {
    const layout = createStd140Layout([
      { name: 'position', type: 'vec3' },
      { name: 'time', type: 'f32' },
      { name: 'rotors', type: 'vec4', count: 2 },
    ]);

    expect(layout.byteSize).toBe(64);
    expect(layout.fields.position.offset).toBe(0);
    expect(layout.fields.position.size).toBe(16);
    expect(layout.fields.time.offset).toBe(16);
    expect(layout.fields.rotors.offset).toBe(32);
    expect(layout.fields.rotors.stride).toBe(16);

    const buffer = createFloat32ArrayForLayout(layout);
    writeField(layout, buffer, 'position', [1, 2, 3]);
    writeField(layout, buffer, 'time', [4]);
    writeField(layout, buffer, 'rotors', [0, 1, 2, 3, 4, 5, 6, 7]);

    const position = readField(layout, buffer, 'position');
    expect(Array.from(position)).toEqual([1, 2, 3]);

    const rotorsFirst = readField(layout, buffer, 'rotors', { elementIndex: 0 });
    const rotorsSecond = readField(layout, buffer, 'rotors', { elementIndex: 1 });
    expect(Array.from(rotorsFirst)).toEqual([0, 1, 2, 3]);
    expect(Array.from(rotorsSecond)).toEqual([4, 5, 6, 7]);
  });

  it('supports std430 tightly packed float arrays', () => {
    const layout = createStd430Layout([
      { name: 'weights', type: 'f32', count: 4 },
    ]);

    expect(layout.byteSize).toBe(16);
    expect(layout.fields.weights.stride).toBe(4);

    const buffer = createFloat32ArrayForLayout(layout);
    writeField(layout, buffer, 'weights', [0.1, 0.2, 0.3, 0.4]);

    const weights = readField(layout, buffer, 'weights', { elementCount: 4 });
    const expected = [0.1, 0.2, 0.3, 0.4];
    weights.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index], 6);
    });
  });
});
