import { WebGPUGlassmorphicPipeline } from '../src/ui/adaptive/renderers/webgpu/WebGPUGlassmorphicPipeline.js';

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
    },
    getReadableBuffer() {
      return { label: `${label}-buffer` };
    },
  };
}

function createMockDevice() {
  return {
    createdTextures: [],
    queue: {
      writeBuffer(buffer, _offset, data) {
        const label = buffer?.label || 'anonymous-buffer';
        console.log(`[queue] writeBuffer -> ${label}, length=${data?.length ?? 'n/a'}`);
      },
    },
    createBuffer({ label = 'buffer' } = {}) {
      return { label };
    },
    createBindGroup({ label = 'bindGroup', entries = [] } = {}) {
      console.log(`[device] createBindGroup -> ${label} (entries=${entries.length})`);
      return { label, entries };
    },
    createTexture({ label = 'texture', size, format }) {
      console.log(`[device] createTexture -> ${label} (${size?.[0]}x${size?.[1]} ${format})`);
      const view = { label: `${label}-view` };
      const texture = {
        label,
        size,
        format,
        createView() {
          return view;
        },
      };
      this.createdTextures.push(texture);
      return texture;
    },
    createRenderBundleEncoder({ label = 'render-bundle', colorFormats }) {
      console.log(`[device] createRenderBundleEncoder -> ${label} (formats=${colorFormats?.join(', ')})`);
      const actions = [];
      return {
        label,
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

function logPassSummary(frameLabel, commandBuffer) {
  console.log(`\n=== ${frameLabel} summary ===`);
  commandBuffer.passes.forEach((pass, index) => {
    const attachment = pass.descriptor?.colorAttachments?.[0];
    const targetLabel = attachment?.view?.label ?? 'unknown-target';
    console.log(`Pass ${index + 1}: target=${targetLabel}`);
    pass.actions.forEach((action) => {
      const [type, ...details] = action;
      console.log(`  - ${type}:`, ...details);
    });
  });
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

async function runDemo() {
  const device = createMockDevice();
  const pipeline = new WebGPUGlassmorphicPipeline(device, {
    layerCount: 2,
    size: { width: 1280, height: 720 },
    useRenderBundles: true,
    uniformRingFactory: (_size, label) => createLoggingRing(label),
  });

  const fullscreenPipelineA = { label: 'fullscreen-layer-0' };
  const fullscreenPipelineB = { label: 'fullscreen-layer-1' };
  const blurHorizontal = { label: 'blur-horizontal' };
  const blurVertical = { label: 'blur-vertical' };
  const compositePipeline = { label: 'composite-pipeline' };

  const layerBindGroups = new Map();
  pipeline.setLayerPipeline(0, fullscreenPipelineA, ({ layerTexture, layerIndex }) => {
    if (!layerBindGroups.has(layerIndex)) {
      const bindGroup = { label: `layer-${layerIndex}-bindGroup-${layerTexture.label}` };
      layerBindGroups.set(layerIndex, bindGroup);
    }
    const bindGroup = layerBindGroups.get(layerIndex);
    console.log(`[bindGroupFactory] layer ${layerIndex} -> ${bindGroup.label}`);
    return bindGroup;
  });

  pipeline.setLayerPipeline(1, fullscreenPipelineB, ({ layerTexture, layerIndex }) => {
    if (!layerBindGroups.has(layerIndex)) {
      const bindGroup = { label: `layer-${layerIndex}-bindGroup-${layerTexture.label}` };
      layerBindGroups.set(layerIndex, bindGroup);
    }
    const bindGroup = layerBindGroups.get(layerIndex);
    console.log(`[bindGroupFactory] layer ${layerIndex} -> ${bindGroup.label}`);
    return bindGroup;
  });

  const blurBindGroups = new Map();
  pipeline.setBlurPipelines(0, {
    horizontal: blurHorizontal,
    vertical: blurVertical,
    bindGroupFactory: ({ direction, sourceTexture, layerIndex }) => {
      const key = `${layerIndex}-${direction}`;
      if (!blurBindGroups.has(key)) {
        const bindGroup = { label: `blur-${direction}-from-${sourceTexture.label}` };
        blurBindGroups.set(key, bindGroup);
      }
      const bindGroup = blurBindGroups.get(key);
      console.log(`[bindGroupFactory] blur ${direction} -> ${bindGroup.label}`);
      return bindGroup;
    },
  });

  const compositeBindGroup = { label: 'composite-bind-group', attachments: [] };
  pipeline.setCompositePipeline(compositePipeline, ({ pipeline: instance }) => {
    if (compositeBindGroup.attachments.length === 0) {
      compositeBindGroup.attachments = instance.getLayerTextureViews().map((view, index) => ({ index, view: view.label }));
    }
    console.log('[bindGroupFactory] composite ->', compositeBindGroup.attachments);
    return compositeBindGroup;
  });

  const targetView = { label: 'final-target-view' };

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

  frames.forEach((frame) => {
    console.log(`\n--- ${frame.label} updates ---`);
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
    logPassSummary(frame.label, commandBuffer);
  });
}

runDemo().catch((error) => {
  console.error('Demo failed:', error);
  process.exitCode = 1;
});
