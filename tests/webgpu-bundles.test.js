import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';
import { WebGPURenderBundleCache } from '../src/ui/adaptive/renderers/webgpu/WebGPURenderBundleCache.js';

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

function createMockDeviceWithBundles() {
  const log = { encoders: [] };
  const device = {
    queue: {
      writeBuffer() {},
    },
    createBuffer() {
      return {};
    },
    createBindGroup(descriptor) {
      return { descriptor };
    },
    createTexture({ label }) {
      return {
        label,
        createView() {
          return { label: `${label}-view` };
        },
      };
    },
    createRenderBundleEncoder(descriptor) {
      const entry = { descriptor, operations: [] };
      log.encoders.push(entry);
      return {
        setPipeline(pipeline) {
          entry.operations.push(['setPipeline', pipeline]);
        },
        setBindGroup(slot, bindGroup) {
          entry.operations.push(['setBindGroup', slot, bindGroup]);
        },
        draw(vertexCount) {
          entry.operations.push(['draw', vertexCount]);
        },
        finish() {
          entry.finished = true;
          return { descriptor, operations: entry.operations };
        },
      };
    },
  };
  return { device, log };
}

function createCommandEncoderLog(target) {
  return {
    beginRenderPass(descriptor) {
      const pass = { descriptor, operations: [] };
      target.push(pass);
      return {
        setPipeline(pipeline) {
          pass.operations.push(['setPipeline', pipeline]);
        },
        setBindGroup(slot, bindGroup) {
          pass.operations.push(['setBindGroup', slot, bindGroup]);
        },
        draw(vertexCount) {
          pass.operations.push(['draw', vertexCount]);
        },
        executeBundles(bundles) {
          pass.operations.push(['executeBundles', bundles]);
        },
        end() {
          pass.ended = true;
        },
      };
    },
  };
}

test('reuses recorded render bundles for layers and composite pass', () => {
  const { device, log } = createMockDeviceWithBundles();
  const poseRing = createRecordingRing('pose');
  const matrixRing = createRecordingRing('matrix');
  const audioRing = createRecordingRing('audio');

  const sharedLayerBindGroup = { label: 'layer-bind-group' };
  const compositeBindGroup = { label: 'composite-bind-group' };

  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    useRenderBundles: true,
    uniformRingFactory: (_size, label) => {
      if (label === 'pose-uniforms') return poseRing;
      if (label === 'matrix-uniforms') return matrixRing;
      return audioRing;
    },
  });

  pipeline.setLayerPipeline(0, { label: 'layer-pipeline' }, () => sharedLayerBindGroup);
  pipeline.setCompositePipeline({ label: 'composite-pipeline' });
  pipeline.setFinalColorFormat('bgra8unorm');

  const passes = [];
  const encoder = createCommandEncoderLog(passes);

  pipeline.render(encoder, { label: 'final-view' }, { compositeBindGroup });
  pipeline.render(encoder, { label: 'final-view' }, { compositeBindGroup });

  assert.equal(log.encoders.length, 2, 'layer and composite bundles should be recorded once');

  const bundledPasses = passes.filter((pass) => {
    const label = pass.descriptor.colorAttachments[0].view.label;
    return label.includes('glassmorphic-layer-0') || label.includes('final-view');
  });

  bundledPasses.forEach(pass => {
    assert.equal(pass.operations[0][0], 'executeBundles');
  });
});

test('blur pipelines receive direction context and render when bundles disabled', () => {
  const { device } = createMockDeviceWithBundles();
  const poseRing = createRecordingRing('pose');
  const matrixRing = createRecordingRing('matrix');
  const audioRing = createRecordingRing('audio');

  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    useRenderBundles: false,
    uniformRingFactory: (_size, label) => {
      if (label === 'pose-uniforms') return poseRing;
      if (label === 'matrix-uniforms') return matrixRing;
      return audioRing;
    },
  });

  const blurCalls = [];
  const horizontalPipeline = { label: 'blur-h' };
  const verticalPipeline = { label: 'blur-v' };
  const blurBindGroups = {
    horizontal: { label: 'blur-h-bind' },
    vertical: { label: 'blur-v-bind' },
  };

  pipeline.setLayerPipeline(0, { label: 'layer-pipeline' }, () => ({ label: 'layer-bind-group' }));
  pipeline.setBlurPipelines(0, {
    horizontal: horizontalPipeline,
    vertical: verticalPipeline,
    bindGroupFactory: (context) => {
      blurCalls.push(context);
      return blurBindGroups[context.direction];
    },
  });
  pipeline.setCompositePipeline({ label: 'composite' });

  const passes = [];
  const encoder = createCommandEncoderLog(passes);
  pipeline.render(encoder, { label: 'final-view' }, { compositeBindGroup: { label: 'composite-bind-group' } });

  assert.equal(blurCalls.length, 2);
  assert.equal(blurCalls[0].direction, 'horizontal');
  assert.equal(blurCalls[1].direction, 'vertical');
  assert.strictEqual(blurCalls[0].sourceTexture.label.includes('glassmorphic-layer-0'), true);
  assert.strictEqual(blurCalls[1].sourceTexture.label.includes('glassmorphic-blur-h-0'), true);

  const blurPasses = passes.filter(pass => pass.descriptor.colorAttachments[0].view.label.includes('glassmorphic-blur'));
  blurPasses.forEach(pass => {
    assert.equal(pass.operations[0][0], 'setPipeline');
    assert.equal(pass.operations[1][0], 'setBindGroup');
    assert.equal(pass.operations[2][0], 'draw');
  });

  const textureViewLabels = pipeline.getLayerTextureViews().map(view => view.label);
  assert.equal(textureViewLabels.length, pipeline.layerCount);
  assert.ok(textureViewLabels[0].includes('glassmorphic-layer-0'));
  assert.equal(pipeline.getLayerTexture(0).label, 'glassmorphic-layer-0');
});

test('WebGPURenderBundleCache caches bundles per key and descriptor', () => {
  let encoderCalls = 0;
  const device = {
    createRenderBundleEncoder(descriptor) {
      encoderCalls += 1;
      return {
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        finish() {
          return { descriptor };
        },
      };
    },
  };

  const cache = new WebGPURenderBundleCache(device, { label: 'test-cache', colorFormats: ['rgba16float'] });
  const key = ['layer', 0];

  const first = cache.record(key, {}, () => {});
  const second = cache.record(key, {}, () => {});

  assert.equal(encoderCalls, 1, 'record should only encode once per key');
  assert.deepEqual(first, second);

  cache.invalidate(key);
  cache.record(key, {}, () => {});
  assert.equal(encoderCalls, 2, 'invalidating should trigger re-encoding');
});

test('WebGPURenderBundleCache requires createRenderBundleEncoder support', () => {
  assert.throws(() => new WebGPURenderBundleCache({}, {}));
});
