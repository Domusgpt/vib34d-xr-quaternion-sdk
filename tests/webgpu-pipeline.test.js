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
  const textures = [];
  return {
    textures,
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
      const texture = {
        label,
        destroyed: false,
        size: null,
        createView() {
          return { label: `${label}-view` };
        },
        destroy() {
          this.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
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

test('uses quaternion compute stage when provided', () => {
  const poseRing = createRecordingRing('pose');
  const matrixRing = createRecordingRing('matrix');
  const audioRing = createRecordingRing('audio');

  const computeStage = {
    calls: [],
    matrixForQuaternion(quaternion, options) {
      this.calls.push({ quaternion, options });
      const target = options?.target || new Float32Array(16);
      target.fill(0);
      target[0] = 42;
      return target;
    },
  };

  const device = createMockDevice();
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    uniformRingFactory: (_size, label) => {
      if (label === 'pose-uniforms') return poseRing;
      if (label === 'matrix-uniforms') return matrixRing;
      return audioRing;
    },
    quaternionCompute: computeStage,
  });

  pipeline.updatePose({
    position: [0, 0, 0],
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  }, { timestamp: 0, motionEnergy: 0 });

  assert.equal(computeStage.calls.length, 1);
  const [{ options }] = computeStage.calls;
  assert.equal(options.normalized, true);
  assert.ok(options.target instanceof Float32Array);
  assert.equal(matrixRing.updates[0][0], 42);
});

test('resizes layer and blur textures when size or blur scale changes', () => {
  const poseRing = createRecordingRing('pose');
  const matrixRing = createRecordingRing('matrix');
  const audioRing = createRecordingRing('audio');

  const device = createMockDevice();
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    layerCount: 2,
    blurScale: 0.5,
    uniformRingFactory: (_size, label) => {
      if (label === 'pose-uniforms') return poseRing;
      if (label === 'matrix-uniforms') return matrixRing;
      return audioRing;
    },
    useRenderBundles: false,
  });

  const initialLayerTextures = pipeline.layerTextures.map((texture) => texture);
  const initialBlurTextures = pipeline.blurTextures.map((entry) => ({
    horizontal: entry.horizontal,
    vertical: entry.vertical,
  }));

  const resized = pipeline.resize({ width: 1024, height: 768 });
  assert.equal(resized, true);
  assert.deepEqual(pipeline.getSize(), { width: 1024, height: 768 });
  initialLayerTextures.forEach((texture) => {
    assert.equal(texture.destroyed, true);
  });
  initialBlurTextures.forEach(({ horizontal, vertical }) => {
    assert.equal(horizontal.destroyed, true);
    assert.equal(vertical.destroyed, true);
  });

  const blurChanged = pipeline.resize({ width: 1024, height: 768 }, { blurScale: 0.25 });
  assert.equal(blurChanged, true);
  assert.equal(pipeline.blurScale, 0.25);

  const noChange = pipeline.resize({ width: 1024, height: 768 }, { blurScale: 0.25 });
  assert.equal(noChange, false);
});
