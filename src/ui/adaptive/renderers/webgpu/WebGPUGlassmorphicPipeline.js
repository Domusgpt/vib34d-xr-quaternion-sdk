import {
  normalizeQuaternionObject,
  quaternionToEuler,
} from '../../../../core/quaternion/index.js';
import { TripleBufferedUniform } from './TripleBufferedUniform.js';
import { WebGPURenderBundleCache } from './WebGPURenderBundleCache.js';

const DEFAULT_LAYER_COUNT = 5;
const DEFAULT_AUDIO_BINS = 128;
const DEFAULT_TEXTURE_FORMAT = 'rgba16float';
const CLEAR_COLOR = { r: 0, g: 0, b: 0, a: 0 };
const DEFAULT_DRAW_VERTEX_COUNT = 6;

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

function quaternionToMatrix(quaternion, target) {
  const { x, y, z, w } = quaternion;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  const result = target instanceof Float32Array && target.length >= 16
    ? target
    : new Float32Array(16);

  result[0] = 1 - 2 * (yy + zz);
  result[1] = 2 * (xy - wz);
  result[2] = 2 * (xz + wy);
  result[3] = 0;

  result[4] = 2 * (xy + wz);
  result[5] = 1 - 2 * (xx + zz);
  result[6] = 2 * (yz - wx);
  result[7] = 0;

  result[8] = 2 * (xz - wy);
  result[9] = 2 * (yz + wx);
  result[10] = 1 - 2 * (xx + yy);
  result[11] = 0;

  result[12] = 0;
  result[13] = 0;
  result[14] = 0;
  result[15] = 1;

  return result;
}

function slerpQuaternion(start, end, alpha) {
  const clampAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  let dot = start.x * end.x + start.y * end.y + start.z * end.z + start.w * end.w;

  const target = { ...end };
  if (dot < 0) {
    dot = -dot;
    target.x = -target.x;
    target.y = -target.y;
    target.z = -target.z;
    target.w = -target.w;
  }

  if (dot > 0.9995) {
    const result = {
      x: start.x + (target.x - start.x) * clampAlpha,
      y: start.y + (target.y - start.y) * clampAlpha,
      z: start.z + (target.z - start.z) * clampAlpha,
      w: start.w + (target.w - start.w) * clampAlpha,
    };
    return normalizeQuaternionObject(result);
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * clampAlpha;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);

  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return {
    x: s0 * start.x + s1 * target.x,
    y: s0 * start.y + s1 * target.y,
    z: s0 * start.z + s1 * target.z,
    w: s0 * start.w + s1 * target.w,
  };
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
    this.useRenderBundles = options.useRenderBundles !== false;
    this.finalColorFormat = options.finalColorFormat || null;

    const uniformRingFactory = options.uniformRingFactory || ((size, label, opts) => new TripleBufferedUniform(device, size, { ...opts, label }));

    this.poseUniforms = uniformRingFactory(5 * 4 * 4, 'pose-uniforms');
    this.matrixUniforms = uniformRingFactory(16 * 4, 'matrix-uniforms');
    this.audioUniforms = uniformRingFactory(this.audioBinCount * 4, 'audio-uniforms');

    this.poseScratch = new Float32Array(20);
    this.matrixScratch = new Float32Array(16);
    this.audioScratch = new Float32Array(this.audioBinCount);
    this.rotScratch = new Float32Array(3);

    this.quaternionCompute = options.quaternionCompute || null;

    this.layerTextures = this.createLayerTextures();
    this.blurTextures = this.createBlurTextures();

    this.layerPipelines = Array.from({ length: this.layerCount }, () => null);
    this.layerBindGroupFactories = Array.from({ length: this.layerCount }, () => null);
    this.layerBundleState = Array.from({ length: this.layerCount }, () => ({ pipeline: null, bindGroup: null, bundle: null }));

    this.blurPipelineConfigs = Array.from({ length: this.layerCount }, () => null);
    this.blurBundleState = Array.from({ length: this.layerCount }, () => ({ horizontal: null, vertical: null }));

    this.compositePipeline = null;
    this.compositeBindGroupFactory = null;
    this.compositeBundleState = { pipeline: null, bindGroup: null, bundle: null };

    const renderBundleCacheFactory = options.renderBundleCacheFactory;
    const supportsBundles = typeof device.createRenderBundleEncoder === 'function';
    this.renderBundleCache = this.useRenderBundles && supportsBundles
      ? (typeof renderBundleCacheFactory === 'function'
        ? renderBundleCacheFactory(device, { label: 'glassmorphic-bundles', colorFormats: [this.textureFormat] })
        : new WebGPURenderBundleCache(device, { label: 'glassmorphic-bundles', colorFormats: [this.textureFormat] }))
      : null;

    this.previousSmoothedQuaternion = null;
    this.lastTimestamp = null;
  }

  setFinalColorFormat(format) {
    this.finalColorFormat = format || null;
    this.invalidateCompositeBundle();
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
    this.layerPipelines[index] = pipeline || null;
    this.layerBindGroupFactories[index] = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;
    this.invalidateLayerBundle(index);
  }

  setCompositePipeline(pipeline, bindGroupFactory) {
    this.compositePipeline = pipeline || null;
    this.compositeBindGroupFactory = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;
    this.invalidateCompositeBundle();
  }

  setBlurPipelines(index, config = {}) {
    if (index < 0 || index >= this.layerCount) {
      throw new Error(`Layer index ${index} is out of bounds for ${this.layerCount} layers.`);
    }

    const { horizontal = null, vertical = null, bindGroupFactory = null } = config;
    const factory = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;

    this.blurPipelineConfigs[index] = (horizontal || vertical || factory)
      ? { horizontal, vertical, bindGroupFactory: factory }
      : null;

    this.invalidateBlurBundles(index);
  }

  updatePose(pose = {}, metadata = {}) {
    const orientation = normalizeQuaternionObject(pose.orientation);
    const position = toVector3(pose.position);

    const smoothed = this.previousSmoothedQuaternion
      ? slerpQuaternion(this.previousSmoothedQuaternion, orientation, this.smoothingFactor)
      : orientation;

    this.previousSmoothedQuaternion = smoothed;

    const euler = quaternionToEuler(orientation);
    const rot4d = this.rotScratch;
    rot4d[0] = euler.pitch * this.rot4dScale;
    rot4d[1] = euler.yaw * this.rot4dScale;
    rot4d[2] = euler.roll * this.rot4dScale;

    const motionEnergy = Number(metadata.motionEnergy) || 0;
    const timestamp = typeof metadata.timestamp === 'number' ? metadata.timestamp : performance?.now?.() ?? Date.now();
    const timestampSeconds = timestamp / 1000;
    const deltaSeconds = this.lastTimestamp == null ? 0 : Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    const poseArray = this.poseScratch;
    poseArray[0] = position[0];
    poseArray[1] = position[1];
    poseArray[2] = position[2];
    poseArray[3] = this.smoothingFactor;

    poseArray[4] = orientation.x;
    poseArray[5] = orientation.y;
    poseArray[6] = orientation.z;
    poseArray[7] = orientation.w;

    poseArray[8] = smoothed.x;
    poseArray[9] = smoothed.y;
    poseArray[10] = smoothed.z;
    poseArray[11] = smoothed.w;

    poseArray[12] = rot4d[0];
    poseArray[13] = rot4d[1];
    poseArray[14] = rot4d[2];
    poseArray[15] = motionEnergy;

    poseArray[16] = timestampSeconds;
    poseArray[17] = deltaSeconds;
    poseArray[18] = 0;
    poseArray[19] = 0;

    this.poseUniforms.update(this.device, poseArray);

    const matrixTarget = this.matrixScratch;
    const matrixData = this.quaternionCompute && typeof this.quaternionCompute.matrixForQuaternion === 'function'
      ? this.quaternionCompute.matrixForQuaternion(orientation, { normalized: true, target: matrixTarget })
      : quaternionToMatrix(orientation, matrixTarget);

    this.matrixUniforms.update(this.device, matrixData);
  }

  updateAudio(frequencies) {
    const data = this.audioScratch;
    data.fill(0);
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

    this.layerTextures.forEach((texture, index) => {
      const renderPassDescriptor = {
        colorAttachments: [{
          view: texture.createView(),
          clearValue: CLEAR_COLOR,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      };

      const pass = commandEncoder.beginRenderPass(renderPassDescriptor);
      const pipeline = this.layerPipelines[index];
      const bindGroupFactory = this.layerBindGroupFactories[index];
      const bindGroup = bindGroupFactory ? bindGroupFactory({
        pipeline,
        layerIndex: index,
        pipelineInstance: this,
        layerTexture: texture,
        blurTextures: this.blurTextures[index],
      }) : layerBindGroups[index];

      this.executePass(pass, {
        pipeline,
        bindGroup,
        bundleKey: ['layer', index],
        vertexCount: options.layerDrawVertexCount || DEFAULT_DRAW_VERTEX_COUNT,
      });
      pass.end?.();

      this.executeBlurPasses(commandEncoder, index, texture);
    });

    const compositePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    const compositeBindGroup = this.compositeBindGroupFactory
      ? this.compositeBindGroupFactory({ pipeline: this })
      : options.compositeBindGroup;

    this.executePass(compositePass, {
      pipeline: this.compositePipeline,
      bindGroup: compositeBindGroup,
      bundleKey: ['composite'],
      vertexCount: options.compositeDrawVertexCount || DEFAULT_DRAW_VERTEX_COUNT,
      colorFormats: [options.finalColorFormat || this.finalColorFormat],
    });

    compositePass.end?.();
  }

  executeBlurPasses(commandEncoder, index, layerTexture) {
    const blur = this.blurTextures[index];
    const config = this.blurPipelineConfigs[index];
    if (!blur || !config) {
      return;
    }

    const { horizontal, vertical, bindGroupFactory } = config;

    if (horizontal) {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: blur.horizontal.createView(),
          clearValue: CLEAR_COLOR,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      const bindGroup = bindGroupFactory?.({
        direction: 'horizontal',
        layerIndex: index,
        pipeline: horizontal,
        sourceTexture: layerTexture,
        targetTexture: blur.horizontal,
      });

      this.executePass(pass, {
        pipeline: horizontal,
        bindGroup,
        bundleKey: ['blur', index, 'horizontal'],
      });
      pass.end?.();
    }

    if (vertical) {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: blur.vertical.createView(),
          clearValue: CLEAR_COLOR,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      const bindGroup = bindGroupFactory?.({
        direction: 'vertical',
        layerIndex: index,
        pipeline: vertical,
        sourceTexture: blur.horizontal,
        targetTexture: blur.vertical,
      });

      this.executePass(pass, {
        pipeline: vertical,
        bindGroup,
        bundleKey: ['blur', index, 'vertical'],
      });
      pass.end?.();
    }
  }

  executePass(pass, options = {}) {
    const {
      pipeline,
      bindGroup,
      bundleKey,
      vertexCount = DEFAULT_DRAW_VERTEX_COUNT,
      colorFormats,
    } = options;

    const useBundles = this.renderBundleCache && this.useRenderBundles && pass && typeof pass.executeBundles === 'function';

    if (useBundles && pipeline && bindGroup) {
      const key = Array.isArray(bundleKey) ? bundleKey : ['pass'];
      const descriptor = {
        colorFormats: colorFormats?.filter(Boolean) ?? [this.textureFormat],
      };
      const existingState = this.getBundleState(key);
      if (existingState && (existingState.pipeline !== pipeline || existingState.bindGroup !== bindGroup)) {
        this.invalidateBundleForKey(key);
      }
      const bundle = this.renderBundleCache.record(key, descriptor, (encoder) => {
        encoder.setPipeline?.(pipeline);
        encoder.setBindGroup?.(0, bindGroup);
        encoder.draw?.(vertexCount);
      });
      pass.executeBundles([bundle]);
      this.updateBundleState(key, { pipeline, bindGroup, bundle });
      return;
    }

    if (pipeline && typeof pass.setPipeline === 'function') {
      pass.setPipeline(pipeline);
    }
    if (bindGroup && typeof pass.setBindGroup === 'function') {
      pass.setBindGroup(0, bindGroup);
    }
    if (typeof pass.draw === 'function') {
      pass.draw(vertexCount);
    }
  }

  updateBundleState(keyParts, state) {
    const [type, index, direction] = keyParts;
    if (type === 'layer' && typeof index === 'number') {
      this.layerBundleState[index] = state;
      return;
    }
    if (type === 'blur' && typeof index === 'number') {
      const existing = this.blurBundleState[index] || { horizontal: null, vertical: null };
      if (direction === 'horizontal') {
        existing.horizontal = state;
      } else if (direction === 'vertical') {
        existing.vertical = state;
      }
      this.blurBundleState[index] = existing;
      return;
    }
    if (type === 'composite') {
      this.compositeBundleState = state;
    }
  }

  getBundleState(keyParts) {
    const [type, index, direction] = keyParts;
    if (type === 'layer' && typeof index === 'number') {
      return this.layerBundleState[index];
    }
    if (type === 'blur' && typeof index === 'number') {
      const entry = this.blurBundleState[index];
      if (!entry) {
        return null;
      }
      return direction === 'horizontal' ? entry.horizontal : entry.vertical;
    }
    if (type === 'composite') {
      return this.compositeBundleState;
    }
    return null;
  }

  invalidateLayerBundle(index) {
    this.renderBundleCache?.invalidate(['layer', index]);
    this.layerBundleState[index] = { pipeline: null, bindGroup: null, bundle: null };
  }

  invalidateBlurBundles(index) {
    this.renderBundleCache?.invalidate(['blur', index, 'horizontal']);
    this.renderBundleCache?.invalidate(['blur', index, 'vertical']);
    this.blurBundleState[index] = { horizontal: null, vertical: null };
  }

  invalidateCompositeBundle() {
    this.renderBundleCache?.invalidate(['composite']);
    this.compositeBundleState = { pipeline: null, bindGroup: null, bundle: null };
  }

  invalidateBundleForKey(keyParts) {
    const [type, index] = keyParts;
    if (type === 'layer' && typeof index === 'number') {
      this.invalidateLayerBundle(index);
      return;
    }
    if (type === 'blur' && typeof index === 'number') {
      this.invalidateBlurBundles(index);
      return;
    }
    if (type === 'composite') {
      this.invalidateCompositeBundle();
    }
  }

  getLayerTexture(index) {
    if (index < 0 || index >= this.layerCount) {
      throw new Error(`Layer index ${index} is out of bounds for ${this.layerCount} layers.`);
    }
    return this.layerTextures[index];
  }

  getLayerTextureViews() {
    return this.layerTextures.map((texture) => texture.createView());
  }
}

export default WebGPUGlassmorphicPipeline;
