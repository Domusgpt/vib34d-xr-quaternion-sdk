import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';
import { WebGPUXRFrameLoop } from '../src/ui/adaptive/renderers/webgpu/WebGPUXRFrameLoop.js';
import {
  createLoggingRing,
  createMockDevice,
  logPassSummary,
  makeQuaternionFromAxisY,
} from './shared/demo-helpers.js';

function createMockSession() {
  let frameCallback = null;
  return {
    requestAnimationFrame(callback) {
      frameCallback = callback;
      return 0;
    },
    cancelAnimationFrame() {},
    updateRenderState(state) {
      console.log('[session] updateRenderState ->', state?.layers?.map((layer) => layer.label));
    },
    pumpFrame(time, frame) {
      if (frameCallback) {
        frameCallback(time, frame);
      }
    },
  };
}

function createMockBinding(session, device) {
  console.log('[binding] XRGPUBinding created');
  return {
    getPreferredColorFormat() {
      return 'bgra8unorm';
    },
    createProjectionLayer() {
      console.log('[binding] createProjectionLayer');
      return { label: 'projection-layer' };
    },
    getViewSubImage(_layer, view) {
      return {
        colorTexture: {
          label: `color-${view.eye}`,
          createView() {
            return { label: `color-${view.eye}-view` };
          },
        },
        viewport: {
          x: 0,
          y: 0,
          width: 1824,
          height: 1920,
        },
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

async function runDemo() {
  const device = createMockDevice({
    onSubmit(commandBuffers) {
      const [commandBuffer] = commandBuffers || [];
      if (!commandBuffer) {
        return;
      }
      logPassSummary('command encoder', commandBuffer);
    },
  });
  const session = createMockSession();
  const bindingFactory = createMockBinding;

  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    layerCount: 2,
    size: { width: 1024, height: 1024 },
    uniformRingFactory: (_size, label) => createLoggingRing(label),
  });

  pipeline.setLayerPipeline(0, { label: 'layer-0' });
  pipeline.setLayerPipeline(1, { label: 'layer-1' });
  pipeline.setCompositePipeline({ label: 'composite' });

  const loop = new WebGPUXRFrameLoop({
    device,
    session,
    pipeline,
    referenceSpace: {},
    bindingFactory,
    audioAnalyzer: {
      frequencyBinCount: 4,
      getByteFrequencyData(target) {
        target.set([0, 128, 64, 255]);
      },
    },
  });

  loop.start();

  session.pumpFrame(0, createMockFrame({ yawDeg: 5 }));
  session.pumpFrame(11.1, createMockFrame({ yawDeg: 25 }));

  loop.stop();
}

runDemo().catch((error) => {
  console.error('Demo failed', error);
  process.exitCode = 1;
});
