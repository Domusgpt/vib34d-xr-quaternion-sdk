import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';
import { WebGPUXRFrameLoop } from '../src/ui/adaptive/renderers/webgpu/WebGPUXRFrameLoop.js';
import {
  createLoggingRing,
  createMockDevice,
  makeQuaternionFromAxisY,
  summarizeCommandBuffer,
} from './shared/demo-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EXAMPLES_DIR = path.join(ROOT_DIR, 'DOCS', 'examples');

function ensureExamplesDir() {
  fs.mkdirSync(EXAMPLES_DIR, { recursive: true });
}

function writeExample(name, payload) {
  const filePath = path.join(EXAMPLES_DIR, name);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[examples] wrote ${path.relative(ROOT_DIR, filePath)}`);
}

function createRingCollector(options = {}) {
  const rings = new Map();
  return {
    rings,
    factory: (_size, label) => {
      if (!rings.has(label)) {
        rings.set(label, createLoggingRing(label, { log: false, includePoseBreakdown: false, ...options }));
      }
      return rings.get(label);
    },
  };
}

function collectUniformDiff(ring, startIndex) {
  if (!ring) {
    return [];
  }
  return ring.updates.slice(startIndex);
}

function capturePipelineExample() {
  const uniformCollector = createRingCollector({ decimals: 4 });
  const device = createMockDevice({ log: false });
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    layerCount: 2,
    size: { width: 1280, height: 720 },
    useRenderBundles: true,
    uniformRingFactory: uniformCollector.factory,
  });

  const fullscreenPipelineA = { label: 'fullscreen-layer-0' };
  const fullscreenPipelineB = { label: 'fullscreen-layer-1' };
  const blurHorizontal = { label: 'blur-horizontal' };
  const blurVertical = { label: 'blur-vertical' };
  const compositePipeline = { label: 'composite-pipeline' };

  pipeline.setLayerPipeline(0, fullscreenPipelineA, ({ layerTexture, layerIndex }) => ({
    label: `layer-${layerIndex}-bindGroup-${layerTexture.label}`,
  }));

  pipeline.setLayerPipeline(1, fullscreenPipelineB, ({ layerTexture, layerIndex }) => ({
    label: `layer-${layerIndex}-bindGroup-${layerTexture.label}`,
  }));

  pipeline.setBlurPipelines(0, {
    horizontal: blurHorizontal,
    vertical: blurVertical,
    bindGroupFactory: ({ direction, sourceTexture }) => ({
      label: `blur-${direction}-from-${sourceTexture.label}`,
    }),
  });

  pipeline.setCompositePipeline(compositePipeline, ({ pipeline: instance }) => ({
    label: 'composite-bind-group',
    attachments: instance.getLayerTextureViews().map((view, index) => ({ index, view: view.label })),
  }));

  const frames = [
    {
      label: 'Frame 1',
      timestamp: 0,
      motionEnergy: 0.2,
      position: [1, 1.5, -2],
      orientation: makeQuaternionFromAxisY(25),
      audio: new Uint8Array([0, 64, 192, 255]),
    },
    {
      label: 'Frame 2',
      timestamp: 16,
      motionEnergy: 0.35,
      position: [1.2, 1.6, -1.8],
      orientation: makeQuaternionFromAxisY(60),
      audio: new Uint8Array([16, 128, 220, 255]),
    },
  ];

  const targetView = { label: 'final-target-view' };

  const poseRing = uniformCollector.rings.get('pose-uniforms');
  const matrixRing = uniformCollector.rings.get('matrix-uniforms');
  const audioRing = uniformCollector.rings.get('audio-uniforms');

  const frameSummaries = frames.map((frame, index) => {
    const audioStart = audioRing?.updates.length ?? 0;
    const poseStart = poseRing?.updates.length ?? 0;
    const matrixStart = matrixRing?.updates.length ?? 0;

    pipeline.updateAudio(frame.audio);
    pipeline.updatePose({
      position: frame.position,
      orientation: frame.orientation,
    }, {
      timestamp: frame.timestamp,
      motionEnergy: frame.motionEnergy,
    });

    const encoder = device.createCommandEncoder({ label: `${frame.label.toLowerCase().replace(/\s+/g, '-')}-encoder` });
    pipeline.render(encoder, targetView);
    const commandBuffer = encoder.finish();
    const passes = summarizeCommandBuffer(commandBuffer);

    return {
      index,
      label: frame.label,
      timestampMs: frame.timestamp,
      motionEnergy: frame.motionEnergy,
      poseUniforms: collectUniformDiff(poseRing, poseStart),
      matrixUniforms: collectUniformDiff(matrixRing, matrixStart),
      audioUniforms: collectUniformDiff(audioRing, audioStart),
      renderPasses: passes,
    };
  });

  return {
    layerTextures: device.createdTextures.map((texture) => ({ label: texture.label, format: texture.format })),
    frames: frameSummaries,
  };
}

function createMockSession(events) {
  let callback = null;
  return {
    requestAnimationFrame(next) {
      callback = next;
      return 0;
    },
    cancelAnimationFrame() {},
    updateRenderState(state) {
      events.push({ type: 'updateRenderState', layers: state?.layers?.map((layer) => layer.label) || [] });
    },
    pumpFrame(time, frame) {
      if (callback) {
        callback(time, frame);
      }
    },
  };
}

function createMockBinding() {
  return {
    getPreferredColorFormat() {
      return 'bgra8unorm';
    },
    createProjectionLayer() {
      return { label: 'projection-layer' };
    },
    getViewSubImage(_layer, view) {
      const colorLabel = `color-${view.eye}`;
      return {
        colorTexture: {
          label: colorLabel,
          createView() {
            return { label: `${colorLabel}-view` };
          },
        },
        viewport: {
          x: 0,
          y: 0,
          width: 1824,
          height: 1920,
        },
        textureWidth: 1824,
        textureHeight: 1920,
      };
    },
  };
}

function createMockFrame({ yawDeg = 0 } = {}) {
  return {
    getViewerPose() {
      return {
        transform: {
          position: { x: 0, y: 1.6, z: -0.2 },
          orientation: makeQuaternionFromAxisY(yawDeg),
        },
        views: [
          { eye: 'left' },
          { eye: 'right' },
        ],
      };
    },
  };
}

function captureXRExample() {
  const uniformCollector = createRingCollector({ decimals: 4 });
  const sessionEvents = [];
  const submittedSummaries = [];

  const device = createMockDevice({
    log: false,
    onSubmit(commandBuffers) {
      (commandBuffers || []).forEach((commandBuffer) => {
        submittedSummaries.push({
          label: commandBuffer.label,
          passes: summarizeCommandBuffer(commandBuffer),
        });
      });
    },
  });

  const session = createMockSession(sessionEvents);
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    layerCount: 2,
    size: { width: 1024, height: 1024 },
    uniformRingFactory: uniformCollector.factory,
  });

  pipeline.setLayerPipeline(0, { label: 'layer-0' });
  pipeline.setLayerPipeline(1, { label: 'layer-1' });
  pipeline.setCompositePipeline({ label: 'composite' });

  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace: {},
    bindingFactory: createMockBinding,
    audioAnalyzer: {
      frequencyBinCount: 4,
      getByteFrequencyData(target) {
        target.set([0, 128, 64, 255]);
      },
    },
    logger: {
      log() {},
      warn() {},
    },
  });

  loop.start();

  const frames = [
    { time: 0, yawDeg: 5 },
    { time: 11.1, yawDeg: 25 },
  ];

  frames.forEach((entry) => {
    session.pumpFrame(entry.time, createMockFrame({ yawDeg: entry.yawDeg }));
  });

  loop.stop();

  const poseRing = uniformCollector.rings.get('pose-uniforms');
  const matrixRing = uniformCollector.rings.get('matrix-uniforms');
  const audioRing = uniformCollector.rings.get('audio-uniforms');

  return {
    sessionEvents,
    uniformUpdates: {
      pose: poseRing?.updates || [],
      matrix: matrixRing?.updates || [],
      audio: audioRing?.updates || [],
    },
    submittedCommands: submittedSummaries,
  };
}

async function run() {
  ensureExamplesDir();
  const pipelineExample = capturePipelineExample();
  writeExample('webgpu-pipeline-production.json', pipelineExample);

  const xrExample = captureXRExample();
  writeExample('webgpu-xr-loop-production.json', xrExample);

  console.log('\nExamples generated successfully.');
}

run().catch((error) => {
  console.error('Failed to generate examples:', error);
  process.exitCode = 1;
});
