import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(REPO_ROOT, 'DOCS', 'productions');
const OUTPUT_FILE = join(OUTPUT_DIR, 'webgpu-glassmorphic-sample.json');

function toRoundedArray(array, decimals = 4) {
  if (!array) {
    return null;
  }
  const precision = 10 ** decimals;
  return Array.from(array, (value) => Math.round(Number(value) * precision) / precision);
}

function createProductionDevice() {
  return {
    queue: {
      writeBuffer() {},
    },
    createBuffer({ label = 'buffer' } = {}) {
      return { label };
    },
    createBindGroup({ label = 'bindGroup', entries = [] } = {}) {
      return { label, entries };
    },
    createTexture({ label = 'texture', size, format }) {
      const view = { label: `${label}-view`, descriptor: { size, format } };
      return {
        label,
        size,
        format,
        createView() {
          return view;
        },
        destroy() {},
      };
    },
    createRenderBundleEncoder({ label = 'render-bundle', colorFormats } = {}) {
      const actions = [];
      return {
        label,
        colorFormats,
        actions,
        setPipeline(pipeline) {
          actions.push(['setPipeline', pipeline?.label ?? 'pipeline']);
        },
        setBindGroup(slot, bindGroup) {
          actions.push(['setBindGroup', slot, bindGroup?.label ?? 'bindGroup']);
        },
        draw(vertexCount) {
          actions.push(['draw', vertexCount]);
        },
        finish() {
          return { label: `${label}::bundle`, actions: [...actions] };
        },
      };
    },
    createCommandEncoder({ label = 'command-encoder' } = {}) {
      const passes = [];
      return {
        label,
        passes,
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
            draw(vertexCount) {
              actions.push(['draw', vertexCount]);
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
          return { label: `${label}::commands`, passes: [...passes] };
        },
      };
    },
  };
}

function summarizePasses(commandBuffer) {
  return commandBuffer.passes.map((pass) => {
    const attachment = pass.descriptor?.colorAttachments?.[0];
    const target = attachment?.view?.label ?? 'unknown-target';
    const clearValue = attachment?.clearValue ?? null;
    return {
      target,
      clearValue,
      actions: pass.actions.map(([type, ...details]) => ({ type, details })),
    };
  });
}

async function exportProductions() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const device = createProductionDevice();
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    layerCount: 2,
    size: { width: 1280, height: 720 },
    useRenderBundles: true,
  });

  const fullscreenPipelineA = { label: 'fullscreen-layer-0' };
  const fullscreenPipelineB = { label: 'fullscreen-layer-1' };
  const blurHorizontal = { label: 'blur-horizontal' };
  const blurVertical = { label: 'blur-vertical' };
  const compositePipeline = { label: 'composite-pipeline' };

  pipeline.setLayerPipeline(0, fullscreenPipelineA, () => ({ label: 'layer-0-bindGroup' }));
  pipeline.setLayerPipeline(1, fullscreenPipelineB, () => ({ label: 'layer-1-bindGroup' }));
  pipeline.setBlurPipelines(0, {
    horizontal: blurHorizontal,
    vertical: blurVertical,
    bindGroupFactory: ({ direction }) => ({ label: `blur-${direction}-bindGroup` }),
  });
  pipeline.setCompositePipeline(compositePipeline, () => ({ label: 'composite-bindGroup' }));

  const targetView = { label: 'final-target-view' };

  const frames = [
    {
      label: 'Frame 1',
      timestamp: 0,
      motionEnergy: 0.18,
      position: [1, 1.5, -2],
      orientation: { x: 0, y: Math.sin((15 * Math.PI) / 180), z: 0, w: Math.cos((15 * Math.PI) / 180) },
      audio: new Uint8Array([0, 64, 192, 255, 128, 0, 32, 255]),
    },
    {
      label: 'Frame 2',
      timestamp: 16,
      motionEnergy: 0.27,
      position: [1.2, 1.6, -1.8],
      orientation: { x: 0, y: Math.sin((45 * Math.PI) / 180), z: 0, w: Math.cos((45 * Math.PI) / 180) },
      audio: new Uint8Array([16, 128, 220, 255, 96, 8, 48, 240]),
    },
    {
      label: 'Frame 3',
      timestamp: 32,
      motionEnergy: 0.33,
      position: [1.4, 1.75, -1.5],
      orientation: { x: 0, y: Math.sin((75 * Math.PI) / 180), z: 0, w: Math.cos((75 * Math.PI) / 180) },
      audio: new Uint8Array([32, 140, 240, 255, 160, 32, 64, 224]),
    },
  ];

  const productions = [];

  frames.forEach((frame) => {
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

    const snapshot = pipeline.getProductionSnapshot({
      label: frame.label,
      timestamp: frame.timestamp,
      motionEnergy: frame.motionEnergy,
    });

    productions.push({
      frame: frame.label,
      timestamp: frame.timestamp,
      motionEnergy: frame.motionEnergy,
      input: {
        position: [...frame.position],
        orientation: frame.orientation,
        audio: Array.from(frame.audio),
      },
      uniforms: {
        pose: toRoundedArray(snapshot.poseUniforms),
        matrix: toRoundedArray(snapshot.matrixUniform),
        audio: toRoundedArray(snapshot.audioUniform),
        poseFloatCount: snapshot.poseFloatCount,
      },
      passes: summarizePasses(commandBuffer),
    });
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    size: pipeline.getSize(),
    textureFormat: pipeline.getFinalColorFormat() || 'rgba16float',
    frames: productions,
  };

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Exported ${productions.length} WebGPU production samples to ${OUTPUT_FILE}`);
}

exportProductions().catch((error) => {
  console.error('Failed to export WebGPU productions:', error);
  process.exitCode = 1;
});
