import assert from 'node:assert/strict';
import test from 'node:test';

import { TripleBufferedUniform } from '../src/ui/adaptive/renderers/webgpu/TripleBufferedUniform.js';

function createMockDevice() {
  const writes = [];
  return {
    writes,
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data: Array.from(new Uint8Array(data.buffer || data)) });
      },
    },
    createBuffer({ size, label }) {
      return { size, label };
    },
    createBindGroup({ layout, entries }) {
      return { layout, entries };
    },
  };
}

test('triple buffered uniform rotates through buffers safely', () => {
  const device = createMockDevice();
  const uniform = new TripleBufferedUniform(device, 16, { label: 'pose' });

  uniform.update(device, new Float32Array([1, 2, 3, 4]));
  assert.equal(uniform.getReadableBuffer().label, 'pose[2]');

  uniform.update(device, new Float32Array([5, 6, 7, 8]));
  assert.equal(uniform.getReadableBuffer().label, 'pose[0]');

  uniform.update(device, new Float32Array([9, 10, 11, 12]));

  assert.equal(device.writes.length, 3);
  assert.equal(device.writes[2].buffer.label, 'pose[2]');
  assert.equal(uniform.getReadableBuffer().label, 'pose[1]');

  const bindGroup = uniform.createBindGroupForLayout('layout');
  assert.equal(bindGroup.entries[0].resource.buffer.label.startsWith('pose['), true);
});

