import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGPUXRFrameLoop } from '../src/ui/adaptive/renderers/webgpu/WebGPUXRFrameLoop.js';
import { composeDualQuaternion, normalizeQuaternionObject } from '../src/core/quaternion/index.js';

function createMockDevice() {
  return {
    encoders: [],
    queue: {
      submissions: [],
      submit(commands) {
        this.submissions.push(commands);
      },
    },
    createCommandEncoder({ label } = {}) {
      const encoder = {
        label,
        finished: false,
        finish() {
          this.finished = true;
          return { label: `${label || 'encoder'}::commands` };
        },
      };
      this.encoders.push(encoder);
      return encoder;
    },
  };
}

function createMockSession() {
  return {
    callbacks: [],
    requestAnimationFrame(callback) {
      this.callbacks.push(callback);
      return this.callbacks.length - 1;
    },
    cancelAnimationFrame(handle) {
      this.callbacks[handle] = null;
    },
    updateRenderStateCalls: [],
    updateRenderState(state) {
      this.updateRenderStateCalls.push(state);
    },
  };
}

function makeQuaternionFromAxisY(degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: 0,
    y: Math.sin(radians / 2),
    z: 0,
    w: Math.cos(radians / 2),
  };
}

function createPose({ position = null, orientation = null, dualQuaternion = null, views = [] }) {
  const transform = {};

  if (Array.isArray(position)) {
    transform.position = {
      x: position[0],
      y: position[1],
      z: position[2],
    };
  }

  if (orientation) {
    transform.orientation = orientation;
  }

  if (dualQuaternion) {
    transform.dualQuaternion = dualQuaternion;
  }

  return { transform, views };
}

test('runs XR frame loop, updates pose/audio, and renders for each view', () => {
  const device = createMockDevice();
  const session = createMockSession();

  const pipeline = {
    poseUpdates: [],
    audioUpdates: [],
    renderCalls: [],
    updatePose(pose, metadata) {
      this.poseUpdates.push({ pose, metadata });
    },
    updateAudio(data) {
      this.audioUpdates.push(Array.from(data));
    },
    render(_encoder, targetView, options) {
      this.renderCalls.push({ targetView, options });
    },
  };

  const analyzer = {
    frequencyBinCount: 4,
    getByteFrequencyData(target) {
      target.set([0, 64, 128, 255]);
    },
  };

  const referenceSpace = {};
  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace,
    audioAnalyzer: analyzer,
    viewProvider: (_frame, view) => ({
      colorView: { label: `color-${view.eye}` },
      finalColorFormat: 'bgra8unorm',
    }),
  });

  loop.start();
  assert.equal(session.callbacks.length, 1);

  const frame = {
    getViewerPose() {
      return createPose({
        position: [1, 2, 3],
        orientation: makeQuaternionFromAxisY(0),
        views: [
          { eye: 'left' },
          { eye: 'right' },
        ],
      });
    },
  };

  session.callbacks[0](0, frame);
  assert.equal(pipeline.poseUpdates.length, 1);
  assert.equal(pipeline.audioUpdates.length, 1);
  assert.equal(pipeline.renderCalls.length, 2);
  assert.equal(device.queue.submissions.length, 1);

  const nextFrame = {
    getViewerPose() {
      return createPose({
        position: [1, 2, 3],
        orientation: makeQuaternionFromAxisY(30),
        views: [
          { eye: 'left' },
          { eye: 'right' },
        ],
      });
    },
  };

  session.callbacks[1](11.1, nextFrame);
  assert.equal(pipeline.poseUpdates.length, 2);
  assert.ok(pipeline.poseUpdates[1].metadata.motionEnergy > 0);
  assert.equal(pipeline.audioUpdates.length, 2);
  assert.equal(device.queue.submissions.length, 2);

  loop.stop();
});

test('derives pose from dual quaternion transforms when provided', () => {
  const device = createMockDevice();
  const session = createMockSession();

  const pipeline = {
    poseUpdates: [],
    audioUpdates: [],
    renderCalls: [],
    updatePose(pose, metadata) {
      this.poseUpdates.push({ pose, metadata });
    },
    updateAudio() {},
    render(_encoder, targetView, options) {
      this.renderCalls.push({ targetView, options });
    },
  };

  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace: {},
    viewProvider: () => ({ colorView: { label: 'color-center' }, finalColorFormat: 'rgba8unorm' }),
  });

  loop.start();

  const angle = Math.PI / 6;
  const orientation = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
  const translation = [0.25, 1, -0.5];
  const dual = composeDualQuaternion(orientation, translation);

  const frame = {
    getViewerPose() {
      return createPose({ dualQuaternion: dual, views: [{ eye: 'center' }] });
    },
  };

  session.callbacks[0](0, frame);

  assert.equal(pipeline.poseUpdates.length, 1);
  const [{ pose, metadata }] = pipeline.poseUpdates;
  const normalizedOrientation = normalizeQuaternionObject(orientation);

  assert.ok(Math.abs(pose.orientation.x - normalizedOrientation.x) < 1e-6);
  assert.ok(Math.abs(pose.orientation.w - normalizedOrientation.w) < 1e-6);
  pose.position.forEach((value, index) => {
    assert.ok(Math.abs(value - translation[index]) < 1e-6);
  });
  assert.deepEqual(pose.dualQuaternion.real, dual.real);
  assert.ok(metadata.motionEnergy >= 0);

  assert.equal(pipeline.renderCalls.length, 1);
  loop.stop();
});

test('auto-configures XRGPUBinding view provider when available', () => {
  const device = createMockDevice();
  const session = createMockSession();

  const colorTexture = {
    label: 'color-texture',
    createView() {
      return { label: 'color-view' };
    },
  };

  const binding = {
    calls: [],
    getPreferredColorFormat() {
      this.calls.push('getPreferredColorFormat');
      return 'rgba8unorm';
    },
    createProjectionLayer(options) {
      this.calls.push(['createProjectionLayer', options]);
      return { label: 'projection-layer' };
    },
    getViewSubImage(_layer, view) {
      this.calls.push(['getViewSubImage', view.eye]);
      return {
        colorTexture,
        getViewDescriptor() {
          return { dimension: '2d' };
        },
      };
    },
  };

  const pipeline = {
    updatePose() {},
    updateAudio() {},
    renderCalls: [],
    render(_encoder, targetView, options) {
      this.renderCalls.push({ targetView, options });
    },
  };

  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace: {},
    bindingFactory: () => binding,
    projectionLayerInit: { colorFormat: 'bgra8unorm' },
  });

  loop.start();
  assert.equal(session.callbacks.length, 1);

  const frame = {
    getViewerPose() {
      return createPose({
        orientation: makeQuaternionFromAxisY(10),
        views: [{ eye: 'left' }],
      });
    },
  };

  session.callbacks[0](16.6, frame);
  assert.equal(binding.calls.some((call) => Array.isArray(call) && call[0] === 'createProjectionLayer'), true);
  assert.equal(binding.calls.some((call) => Array.isArray(call) && call[0] === 'getViewSubImage'), true);
  assert.equal(pipeline.renderCalls.length, 1);
});

test('handles missing pose without crashing and keeps scheduling frames', () => {
  const device = createMockDevice();
  const session = createMockSession();
  const pipeline = {
    updatePoseCalls: 0,
    updatePose() {
      this.updatePoseCalls += 1;
    },
    updateAudio() {},
    render() {
      throw new Error('render should not be called');
    },
  };

  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace: {},
    viewProvider: () => ({ colorView: { label: 'unused' } }),
  });

  loop.start();
  assert.equal(session.callbacks.length, 1);

  const frame = {
    getViewerPose() {
      return null;
    },
  };

  session.callbacks[0](33.2, frame);
  assert.equal(session.callbacks.length, 2);
  assert.equal(pipeline.updatePoseCalls, 0);
  loop.stop();
});

test('auto-resizes pipeline and updates final color format based on view metadata', () => {
  const device = createMockDevice();
  const session = createMockSession();

  const pipeline = {
    poseUpdates: 0,
    audioUpdates: 0,
    renderCalls: [],
    resizeCalls: [],
    finalColorFormats: [],
    currentSize: { width: 640, height: 480 },
    currentFormat: null,
    updatePose() {
      this.poseUpdates += 1;
    },
    updateAudio() {
      this.audioUpdates += 1;
    },
    render(_encoder, targetView, options) {
      this.renderCalls.push({ targetView, options });
    },
    resize(size) {
      this.resizeCalls.push(size);
      this.currentSize = { width: size.width, height: size.height };
      return true;
    },
    getSize() {
      return { ...this.currentSize };
    },
    setFinalColorFormat(format) {
      this.finalColorFormats.push(format);
      this.currentFormat = format;
    },
    getFinalColorFormat() {
      return this.currentFormat;
    },
  };

  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace: {},
    viewProvider: () => ({
      colorView: { label: 'color' },
      finalColorFormat: 'bgra8unorm',
      size: { width: 1200, height: 1200 },
    }),
  });

  loop.start();
  assert.equal(session.callbacks.length, 1);

  const frame = {
    getViewerPose() {
      return createPose({
        orientation: makeQuaternionFromAxisY(5),
        views: [{ eye: 'left' }],
      });
    },
  };

  session.callbacks[0](0, frame);
  assert.equal(pipeline.resizeCalls.length, 1);
  assert.deepEqual(pipeline.resizeCalls[0], { width: 1200, height: 1200 });
  assert.deepEqual(pipeline.getSize(), { width: 1200, height: 1200 });
  assert.equal(pipeline.finalColorFormats.length, 1);
  assert.equal(pipeline.finalColorFormats[0], 'bgra8unorm');

  // Second frame with same size/format should not trigger additional resize or format changes
  session.callbacks[1](16.6, frame);
  assert.equal(pipeline.resizeCalls.length, 1);
  assert.equal(pipeline.finalColorFormats.length, 1);

  loop.stop();
});
