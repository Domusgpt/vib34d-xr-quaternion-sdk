import {
  normalizeQuaternionObject,
  quaternionToEuler,
  quaternionToMatrix4,
  slerpQuaternions,
} from '../../../../core/quaternion/index.js';
import { TripleBufferedUniform } from './TripleBufferedUniform.js';

const DEFAULT_LAYER_COUNT = 5;
const DEFAULT_AUDIO_BINS = 128;
const DEFAULT_TEXTURE_FORMAT = 'rgba16float';
const CLEAR_COLOR = { r: 0, g: 0, b: 0, a: 0 };

function toVector3(value) {
  if (!value) {
    return [0, 0, 0];
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  if (typeof value === 'object') {
    return [Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0];
  }
  return [0, 0, 0];
}

export class WebGPUGlassmorphicPipeline {
  constructor(device, options = {}) {
    if (!device || typeof device.createTexture !== 'function') {
      throw new Error('WebGPUGlassmorphicPipeline requires a GPU device with texture support.');
    }

    this.device = device;
    this.layerCount = Math.max(1, Math.floor(options.layerCount ?? DEFAULT_LAYER_COUNT));
    this.textureFormat = options.textureFormat || DEFAULT_TEXTURE_FORMAT;
    this.size = options.size || { width: 1920, height: 1080 };
    this.blurScale = options.blurScale ?? 0.5;
    this.smoothingFactor = Math.max(0, Math.min(1, options.smoothingFactor ?? 0.9));
    this.rot4dScale = options.rot4dScale ?? 1.0;
    this.audioBinCount = Math.max(1, Math.floor(options.audioBinCount ?? DEFAULT_AUDIO_BINS));

    const uniformRingFactory = options.uniformRingFactory || ((size, label, opts) => new TripleBufferedUniform(device, size, { ...opts, label }));

    this.poseUniforms = uniformRingFactory(5 * 4 * 4, 'pose-uniforms');
    this.matrixUniforms = uniformRingFactory(16 * 4, 'matrix-uniforms');
    this.audioUniforms = uniformRingFactory(this.audioBinCount * 4, 'audio-uniforms');

    this.layerTextures = this.createLayerTextures();
    this.blurTextures = this.createBlurTextures();

    this.layerPasses = Array.from({ length: this.layerCount }, () => ({
      pipeline: null,
      bindGroupFactory: null,
      bundle: null,
    }));

    this.blurPasses = Array.from({ length: this.layerCount }, () => ({
      horizontal: { pipeline: null, bindGroupFactory: null, bundle: null },
      vertical: { pipeline: null, bindGroupFactory: null, bundle: null },
    }));

    this.compositePass = { pipeline: null, bindGroupFactory: null, bundle: null };

    this.previousSmoothedQuaternion = null;
    this.lastTimestamp = null;
    this.matrixScratch = new Float32Array(16);
  }

  createLayerTextures() {
    return Array.from({ length: this.layerCount }, (_, index) => {
      return this.device.createTexture({
        size: [this.size.width, this.size.height],
        format: this.textureFormat,
        usage: (typeof GPUTextureUsage !== 'undefined')
          ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
          : 0,
        label: `glassmorphic-layer-${index}`,
      });
    });
  }

  createBlurTextures() {
    const width = Math.max(1, Math.floor(this.size.width * this.blurScale));
    const height = Math.max(1, Math.floor(this.size.height * this.blurScale));
    return Array.from({ length: this.layerCount }, (_, index) => {
      return {
        horizontal: this.device.createTexture({
          size: [width, height],
          format: this.textureFormat,
          usage: (typeof GPUTextureUsage !== 'undefined')
            ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            : 0,
          label: `glassmorphic-blur-h-${index}`,
        }),
        vertical: this.device.createTexture({
          size: [width, height],
          format: this.textureFormat,
          usage: (typeof GPUTextureUsage !== 'undefined')
            ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            : 0,
          label: `glassmorphic-blur-v-${index}`,
        }),
      };
    });
  }

  setLayerPipeline(index, pipeline, bindGroupFactory) {
    if (index < 0 || index >= this.layerCount) {
      throw new Error(`Layer index ${index} is out of bounds for ${this.layerCount} layers.`);
    }
    const descriptor = this.layerPasses[index];
    descriptor.pipeline = pipeline || null;
    descriptor.bindGroupFactory = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;
  }

  setLayerBundle(index, bundle) {
    if (index < 0 || index >= this.layerCount) {
      throw new Error(`Layer index ${index} is out of bounds for ${this.layerCount} layers.`);
    }
    this.layerPasses[index].bundle = bundle || null;
  }

  setCompositePipeline(pipeline, bindGroupFactory) {
    this.compositePass.pipeline = pipeline || null;
    this.compositePass.bindGroupFactory = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;
  }

  setCompositeBundle(bundle) {
    this.compositePass.bundle = bundle || null;
  }

  setBlurPipeline(index, direction, pipeline, bindGroupFactory) {
    const descriptor = this.resolveBlurDescriptor(index, direction);
    descriptor.pipeline = pipeline || null;
    descriptor.bindGroupFactory = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;
  }

  setBlurBundle(index, direction, bundle) {
    const descriptor = this.resolveBlurDescriptor(index, direction);
    descriptor.bundle = bundle || null;
  }

  resolveBlurDescriptor(index, direction) {
    if (index < 0 || index >= this.layerCount) {
      throw new Error(`Layer index ${index} is out of bounds for ${this.layerCount} layers.`);
    }
    const entry = this.blurPasses[index];
    if (!entry) {
      throw new Error(`Missing blur pass descriptor for layer ${index}.`);
    }
    if (direction === 'horizontal' || direction === 'h') {
      return entry.horizontal;
    }
    if (direction === 'vertical' || direction === 'v') {
      return entry.vertical;
    }
    throw new Error(`Unknown blur direction "${direction}". Expected "horizontal" or "vertical".`);
  }

  updatePose(pose = {}, metadata = {}) {
    const orientation = normalizeQuaternionObject(pose.orientation);
    const position = toVector3(pose.position);

    const smoothed = this.previousSmoothedQuaternion
      ? slerpQuaternions(this.previousSmoothedQuaternion, orientation, this.smoothingFactor)
      : orientation;

    this.previousSmoothedQuaternion = smoothed;

    const euler = quaternionToEuler(smoothed);
    const rot4d = [
      euler.pitch * this.rot4dScale,
      euler.yaw * this.rot4dScale,
      euler.roll * this.rot4dScale,
    ];

    const motionEnergy = Number(metadata.motionEnergy) || 0;
    const timestamp = typeof metadata.timestamp === 'number' ? metadata.timestamp : performance?.now?.() ?? Date.now();
    const timestampSeconds = timestamp / 1000;
    const deltaSeconds = this.lastTimestamp == null ? 0 : Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    const poseArray = new Float32Array([
      position[0], position[1], position[2], this.smoothingFactor,
      orientation.x, orientation.y, orientation.z, orientation.w,
      smoothed.x, smoothed.y, smoothed.z, smoothed.w,
      rot4d[0], rot4d[1], rot4d[2], motionEnergy,
      timestampSeconds, deltaSeconds, 0, 0,
    ]);

    this.poseUniforms.update(this.device, poseArray);
    this.matrixUniforms.update(this.device, quaternionToMatrix4(smoothed, this.matrixScratch));
  }

  updateAudio(frequencies) {
    const data = new Float32Array(this.audioBinCount);
    if (ArrayBuffer.isView(frequencies)) {
      const length = Math.min(frequencies.length, this.audioBinCount);
      const byteSize = frequencies.BYTES_PER_ELEMENT || 0;
      const normalizeFromByte = byteSize === 1;
      for (let index = 0; index < length; index += 1) {
        const value = Number(frequencies[index]) || 0;
        const normalized = normalizeFromByte ? value / 255 : value;
        data[index] = Math.max(0, Math.min(1, normalized));
      }
    }
    this.audioUniforms.update(this.device, data);
  }

  render(commandEncoder, targetView, options = {}) {
    if (!commandEncoder || typeof commandEncoder.beginRenderPass !== 'function') {
      throw new Error('render requires a GPUCommandEncoder with beginRenderPass.');
    }
    if (!targetView || typeof targetView !== 'object') {
      throw new Error('render requires a final color target view.');
    }

    const layerBindGroups = options.layerBindGroups || [];
    const blurBindGroups = options.blurBindGroups || [];

    this.layerTextures.forEach((_texture, index) => {
      this.executeLayerPass(commandEncoder, index, layerBindGroups[index]);

      const blurOverrides = blurBindGroups[index] || {};
      this.executeBlurPass(commandEncoder, index, 'horizontal', blurOverrides.horizontal);
      this.executeBlurPass(commandEncoder, index, 'vertical', blurOverrides.vertical);
    });

    this.executeCompositePass(commandEncoder, targetView, options.compositeBindGroup);
  }

  executeLayerPass(commandEncoder, index, overrideBindGroup) {
    const texture = this.layerTextures[index];
    const descriptor = this.layerPasses[index];
    if (!texture || !descriptor) {
      return;
    }

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    const bindGroup = descriptor.bindGroupFactory
      ? descriptor.bindGroupFactory({
        pipeline: descriptor.pipeline,
        layerIndex: index,
        pipelineInstance: this,
        colorTexture: texture,
      })
      : overrideBindGroup;

    this.executePassCommands(pass, descriptor, bindGroup, 6);
  }

  executeBlurPass(commandEncoder, index, direction, overrideBindGroup) {
    const blurTextures = this.blurTextures[index];
    if (!blurTextures) {
      return;
    }

    const descriptor = this.resolveBlurDescriptor(index, direction);
    const targetTexture = direction === 'horizontal' || direction === 'h'
      ? blurTextures.horizontal
      : blurTextures.vertical;

    if (!targetTexture || !descriptor) {
      return;
    }

    const sourceTexture = direction === 'horizontal' || direction === 'h'
      ? this.layerTextures[index]
      : blurTextures.horizontal;

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: targetTexture.createView(),
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    const bindGroup = descriptor.bindGroupFactory
      ? descriptor.bindGroupFactory({
        pipeline: descriptor.pipeline,
        layerIndex: index,
        direction,
        pipelineInstance: this,
        sourceTexture,
        targetTexture,
      })
      : overrideBindGroup;

    this.executePassCommands(pass, descriptor, bindGroup, 6);
  }

  executeCompositePass(commandEncoder, targetView, overrideBindGroup) {
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    const bindGroup = this.compositePass.bindGroupFactory
      ? this.compositePass.bindGroupFactory({
        pipeline: this.compositePass.pipeline,
        pipelineInstance: this,
        layerTextures: this.layerTextures,
        blurTextures: this.blurTextures,
      })
      : overrideBindGroup;

    this.executePassCommands(pass, this.compositePass, bindGroup, 6);
  }

  executePassCommands(pass, descriptor, bindGroup, vertexCount) {
    const bundles = this.normalizeBundles(descriptor?.bundle);
    if (bundles && bundles.length > 0 && typeof pass.executeBundles === 'function') {
      pass.executeBundles(bundles);
      pass.end();
      return;
    }

    const hasPipeline = !!descriptor?.pipeline && typeof pass.setPipeline === 'function';
    if (hasPipeline) {
      pass.setPipeline(descriptor.pipeline);
    }
    if (bindGroup && typeof pass.setBindGroup === 'function') {
      pass.setBindGroup(0, bindGroup);
    }
    if (hasPipeline && typeof pass.draw === 'function' && Number.isFinite(vertexCount)) {
      pass.draw(vertexCount);
    }
    pass.end();
  }

  normalizeBundles(bundle) {
    if (!bundle) {
      return null;
    }
    if (Array.isArray(bundle)) {
      return bundle.filter(Boolean);
    }
    return [bundle];
  }

  resize(size) {
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
      throw new Error('resize requires a size object with numeric width and height.');
    }

    const width = Math.max(1, Math.floor(size.width));
    const height = Math.max(1, Math.floor(size.height));
    if (width === this.size.width && height === this.size.height) {
      return;
    }

    this.destroyLayerTextures();
    this.destroyBlurTextures();

    this.size = { width, height };
    this.layerTextures = this.createLayerTextures();
    this.blurTextures = this.createBlurTextures();
  }

  dispose() {
    this.destroyLayerTextures();
    this.destroyBlurTextures();

    this.layerTextures = [];
    this.blurTextures = [];
    this.layerPasses = [];
    this.blurPasses = [];
    this.compositePass = { pipeline: null, bindGroupFactory: null, bundle: null };
  }

  destroyLayerTextures() {
    this.layerTextures.forEach((texture) => {
      texture?.destroy?.();
    });
  }

  destroyBlurTextures() {
    this.blurTextures.forEach((entry) => {
      entry?.horizontal?.destroy?.();
      entry?.vertical?.destroy?.();
    });
  }
}

export default WebGPUGlassmorphicPipeline;
