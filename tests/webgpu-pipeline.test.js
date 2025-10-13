import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';

function createRecordingRing(label) {
  return {
    label,
    updates: [],
    update(_device, data) {
      this.updates.push(Array.from(data));
    },
    getReadableBuffer() {
      return { label };
    },
  };
}

function createMockDevice() {
  return {
    queue: {
      writeBuffer() {},
    },
    createBuffer() {
      return {};
    },
    createBindGroup() {
      return {};
    },
    createTexture({ label }) {
      return {
        label,
        createView() {
          return { label: `${label}-view` };
        },
      };
    },
  };
}

test('updates pose uniforms with normalized quaternions and rot4d scaling', () => {
  const poseRing = createRecordingRing('pose');
  const matrixRing = createRecordingRing('matrix');
  const audioRing = createRecordingRing('audio');

  const device = createMockDevice();
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    rot4dScale: 2,
    smoothingFactor: 0.5,
    audioBinCount: 4,
    uniformRingFactory: (_size, label) => {
      if (label === 'pose-uniforms') return poseRing;
      if (label === 'matrix-uniforms') return matrixRing;
      return audioRing;
    },
  });

  const angle = Math.PI / 4;
  const quaternion = { x: 0, y: Math.sin(angle), z: 0, w: Math.cos(angle) };
  pipeline.updatePose({
    position: [1, 2, 3],
    orientation: quaternion,
  }, { timestamp: 1000, motionEnergy: 0.3 });

  assert.equal(poseRing.updates.length, 1);
  const poseData = poseRing.updates[0];
  assert.deepEqual(poseData.slice(0, 4), [1, 2, 3, 0.5]);
  assert.ok(Math.abs(poseData[5] - Math.sin(angle)) < 1e-6);
  assert.ok(Math.abs(poseData[7] - Math.cos(angle)) < 1e-6);
  assert.ok(Math.abs(poseData[12] - Math.PI) < 1e-6);
  assert.ok(Math.abs(poseData[13]) < 1e-6);
  assert.ok(Math.abs(poseData[14]) < 1e-6);
  assert.ok(Math.abs(poseData[15] - 0.3) < 1e-6);
  assert.ok(Math.abs(poseData[16] - 1) < 1e-6);

  assert.equal(matrixRing.updates.length, 1);
  const matrixData = matrixRing.updates[0];
  assert.ok(Math.abs(matrixData[0]) < 1e-6);
  assert.ok(Math.abs(matrixData[2] - 1) < 1e-6);
  assert.ok(Math.abs(matrixData[8] + 1) < 1e-6);
  assert.ok(Math.abs(matrixData[5] - 1) < 1e-6);
});

test('normalizes audio data into [0, 1] range', () => {
  const poseRing = createRecordingRing('pose');
  const matrixRing = createRecordingRing('matrix');
  const audioRing = createRecordingRing('audio');

  const device = createMockDevice();
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    audioBinCount: 4,
    uniformRingFactory: (_size, label) => {
      if (label === 'pose-uniforms') return poseRing;
      if (label === 'matrix-uniforms') return matrixRing;
      return audioRing;
    },
  });

  pipeline.updateAudio(new Uint8Array([0, 64, 128, 255]));
  assert.equal(audioRing.updates.length, 1);
  const data = audioRing.updates[0];
  const expected = [0, 64 / 255, 128 / 255, 1];
  data.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-6);
  });
});
