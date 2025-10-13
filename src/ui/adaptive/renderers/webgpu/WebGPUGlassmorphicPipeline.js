import {
  normalizeQuaternionObject,
  quaternionToEuler,
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

function quaternionToMatrix(quaternion) {
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

  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0,
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0,
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ]);
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

    const uniformRingFactory = options.uniformRingFactory || ((size, label, opts) => new TripleBufferedUniform(device, size, { ...opts, label }));

    this.poseUniforms = uniformRingFactory(5 * 4 * 4, 'pose-uniforms');
    this.matrixUniforms = uniformRingFactory(16 * 4, 'matrix-uniforms');
    this.audioUniforms = uniformRingFactory(this.audioBinCount * 4, 'audio-uniforms');

    this.layerTextures = this.createLayerTextures();
    this.blurTextures = this.createBlurTextures();

    this.layerPipelines = Array.from({ length: this.layerCount }, () => null);
    this.layerBindGroupFactories = Array.from({ length: this.layerCount }, () => null);
    this.compositePipeline = null;
    this.compositeBindGroupFactory = null;

    this.previousSmoothedQuaternion = null;
    this.lastTimestamp = null;
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
  }

  setCompositePipeline(pipeline, bindGroupFactory) {
    this.compositePipeline = pipeline || null;
    this.compositeBindGroupFactory = typeof bindGroupFactory === 'function' ? bindGroupFactory : null;
  }

  updatePose(pose = {}, metadata = {}) {
    const orientation = normalizeQuaternionObject(pose.orientation);
    const position = toVector3(pose.position);

    const smoothed = this.previousSmoothedQuaternion
      ? slerpQuaternion(this.previousSmoothedQuaternion, orientation, this.smoothingFactor)
      : orientation;

    this.previousSmoothedQuaternion = smoothed;

    const euler = quaternionToEuler(orientation);
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
    this.matrixUniforms.update(this.device, quaternionToMatrix(orientation));
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
      }) : layerBindGroups[index];

      if (pipeline && typeof pass.setPipeline === 'function') {
        pass.setPipeline(pipeline);
      }
      if (bindGroup && typeof pass.setBindGroup === 'function') {
        pass.setBindGroup(0, bindGroup);
      }
      if (typeof pass.draw === 'function') {
        pass.draw(6);
      }
      pass.end();

      const blur = this.blurTextures[index];
      if (!blur) {
        return;
      }

      const blurHorizontal = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: blur.horizontal.createView(),
          clearValue: CLEAR_COLOR,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      blurHorizontal.end();

      const blurVertical = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: blur.vertical.createView(),
          clearValue: CLEAR_COLOR,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      blurVertical.end();
    });

    const compositePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    if (this.compositePipeline && typeof compositePass.setPipeline === 'function') {
      compositePass.setPipeline(this.compositePipeline);
    }

    const compositeBindGroup = this.compositeBindGroupFactory
      ? this.compositeBindGroupFactory({ pipeline: this })
      : options.compositeBindGroup;

    if (compositeBindGroup && typeof compositePass.setBindGroup === 'function') {
      compositePass.setBindGroup(0, compositeBindGroup);
    }

    if (typeof compositePass.draw === 'function') {
      compositePass.draw(6);
    }

    compositePass.end();
  }
}

export default WebGPUGlassmorphicPipeline;
