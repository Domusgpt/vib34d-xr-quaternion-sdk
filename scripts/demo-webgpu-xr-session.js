import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';
import { WebGPUXRFrameLoop } from '../src/ui/adaptive/renderers/webgpu/WebGPUXRFrameLoop.js';

function toFixedArray(data, decimals = 3) {
  return Array.from(data, (value) => Number(Number(value).toFixed(decimals)));
}

function createLoggingRing(label) {
  return {
    label,
    updates: [],
    update(_device, data) {
      const snapshot = toFixedArray(data);
      this.updates.push(snapshot);
      console.log(`\n[uniform:${label}] update ->`, snapshot);
      if (label === 'pose-uniforms') {
        const smoothedPosition = snapshot.slice(20, 23);
        const smoothedVelocity = snapshot.slice(24, 27);
        const smoothedAcceleration = snapshot.slice(28, 31);
        const angularVelocity = snapshot.slice(32, 35);
        const angularAcceleration = snapshot.slice(36, 39);
        const smoothedAngularVelocity = snapshot.slice(40, 43);
        const smoothedAngularAcceleration = snapshot.slice(44, 47);
        console.log('  ↳ smoothed translation:', smoothedPosition);
        console.log('  ↳ smoothed velocity   :', smoothedVelocity, 'speed=', snapshot[18]);
        console.log('  ↳ smoothed acceleration:', smoothedAcceleration, 'magnitude=', snapshot[19]);
        console.log('  ↳ angular velocity    :', angularVelocity, 'speed=', snapshot[35]);
        console.log('  ↳ angular acceleration:', angularAcceleration, 'magnitude=', snapshot[39]);
        console.log('  ↳ angular velocity (smoothed)    :', smoothedAngularVelocity, 'factor=', snapshot[43]);
        console.log('  ↳ angular acceleration (smoothed):', smoothedAngularAcceleration, 'factor=', snapshot[47]);
      }
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

function createMockDevice() {
  return {
    queue: {
      submit(commands) {
        console.log(`[queue] submit -> ${commands[0]?.label ?? 'commands'}`);
      },
    },
    createTexture({ label = 'texture', size, format }) {
      console.log(`[device] createTexture -> ${label} (${size?.[0]}x${size?.[1]} ${format})`);
      return {
        label,
        createView() {
          return { label: `${label}-view` };
        },
      };
    },
    createRenderBundleEncoder({ label = 'render-bundle' } = {}) {
      return {
        label,
        actions: [],
        setPipeline(pipeline) {
          this.actions.push(['setPipeline', pipeline?.label ?? 'pipeline']);
        },
        setBindGroup(slot, bindGroup) {
          this.actions.push(['setBindGroup', slot, bindGroup?.label ?? 'bindGroup']);
        },
        draw(count) {
          this.actions.push(['draw', count]);
        },
        finish() {
          return { label: `${label}::bundle`, actions: [...this.actions] };
        },
      };
    },
    createCommandEncoder({ label = 'command-encoder' } = {}) {
      const passes = [];
      return {
        label,
        beginRenderPass(descriptor) {
          const actions = [];
          return {
            descriptor,
            actions,
            setPipeline(pipeline) {
              actions.push(['setPipeline', pipeline?.label ?? 'pipeline']);
            },
            setBindGroup(slot, bindGroup) {
              actions.push(['setBindGroup', slot, bindGroup?.label ?? 'bindGroup']);
            },
            draw(count) {
              actions.push(['draw', count]);
            },
            executeBundles(bundles) {
              actions.push(['executeBundles', bundles.map((bundle) => bundle.label)]);
            },
            end() {
              passes.push({ descriptor, actions: [...actions] });
            },
          };
        },
        finish() {
          console.log('\n=== command encoder summary ===');
          passes.forEach((pass, index) => {
            const target = pass.descriptor?.colorAttachments?.[0]?.view?.label ?? 'unknown';
            console.log(`Pass ${index + 1}: target=${target}`);
            pass.actions.forEach((action) => {
              console.log('  -', action[0], ...action.slice(1));
            });
          });
          return { label: `${label}::commands`, passes: [...passes] };
        },
      };
    },
  };
}

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
  const device = createMockDevice();
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
