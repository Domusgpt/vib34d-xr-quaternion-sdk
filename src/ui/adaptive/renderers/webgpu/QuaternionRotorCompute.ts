import type { GPUBufferLike, GPUDeviceLike, GPUQueueLike } from './TripleBufferedUniform.ts';

const GPU_BUFFER_USAGE_STORAGE = 0x20;
const GPU_BUFFER_USAGE_COPY_DST = 0x8;
const GPU_BUFFER_USAGE_COPY_SRC = 0x1;

export interface GPUShaderModuleLike {
  readonly label?: string;
}

export interface GPUComputePipelineLike {
  readonly label?: string;
  getBindGroupLayout(index: number): GPUBindGroupLayoutLike;
}

export interface GPUBindGroupLayoutLike {
  readonly label?: string;
}

export interface GPUBindGroupLike {
  readonly label?: string;
}

export interface GPUCommandEncoderLike {
  beginComputePass(descriptor?: { label?: string }): GPUComputePassEncoderLike;
}

export interface GPUComputePassEncoderLike {
  setPipeline(pipeline: GPUComputePipelineLike): void;
  setBindGroup(index: number, bindGroup: GPUBindGroupLike): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface GPUComputeDeviceLike extends GPUDeviceLike {
  readonly queue: GPUQueueLike;
  createShaderModule(descriptor: { code: string; label?: string }): GPUShaderModuleLike;
  createComputePipeline(descriptor: {
    label?: string;
    layout?: unknown;
    compute: { module: GPUShaderModuleLike; entryPoint: string };
  }): GPUComputePipelineLike;
  createBindGroup(descriptor: {
    label?: string;
    layout: GPUBindGroupLayoutLike;
    entries: Array<{ binding: number; resource: { buffer: GPUBufferLike } }>;
  }): GPUBindGroupLike;
}

export interface QuaternionRotorComputeOptions {
  readonly device: GPUComputeDeviceLike;
  readonly maxInstances: number;
  readonly workgroupSize?: number;
  readonly label?: string;
}

const DEFAULT_WORKGROUP_SIZE = 64;

const ROTOR_COMPUTE_TEMPLATE = `
struct Quaternion { x: f32, y: f32, z: f32, w: f32 };
struct QuaternionBuffer { values: array<Quaternion> };

struct RotorSample {
  matrix: mat4x4<f32>,
  rot4d: vec4<f32>,
  euler: vec4<f32>,
};

struct RotorBuffer { values: array<RotorSample> };

@group(0) @binding(0) var<storage, read> inputQuats: QuaternionBuffer;
@group(0) @binding(1) var<storage, read_write> outputRotors: RotorBuffer;

fn quat_normalize(q: Quaternion) -> Quaternion {
  let mag_sq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (mag_sq < 1e-8) {
    return Quaternion(0.0, 0.0, 0.0, 1.0);
  }
  let inv = inverseSqrt(mag_sq);
  return Quaternion(q.x * inv, q.y * inv, q.z * inv, q.w * inv);
}

fn quat_to_matrix(q: Quaternion) -> mat4x4<f32> {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;

  let xx = x * x;
  let yy = y * y;
  let zz = z * z;
  let xy = x * y;
  let xz = x * z;
  let yz = y * z;
  let wx = w * x;
  let wy = w * y;
  let wz = w * z;

  return mat4x4<f32>(
    vec4<f32>(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz),        2.0 * (xz - wy),        0.0),
    vec4<f32>(2.0 * (xy - wz),        1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx),        0.0),
    vec4<f32>(2.0 * (xz + wy),        2.0 * (yz - wx),        1.0 - 2.0 * (xx + yy), 0.0),
    vec4<f32>(0.0,                     0.0,                    0.0,                    1.0)
  );
}

fn quat_to_euler(q: Quaternion) -> vec3<f32> {
  let sinr_cosp = 2.0 * (q.w * q.x + q.y * q.z);
  let cosr_cosp = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
  let roll = atan2(sinr_cosp, cosr_cosp);

  let sinp = 2.0 * (q.w * q.y - q.z * q.x);
  var pitch = 0.0;
  if (abs(sinp) >= 1.0) {
    pitch = copysign(0.5 * ${Math.PI}, sinp);
  } else {
    pitch = asin(sinp);
  }

  let siny_cosp = 2.0 * (q.w * q.z + q.x * q.y);
  let cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
  let yaw = atan2(siny_cosp, cosy_cosp);
  return vec3<f32>(roll, pitch, yaw);
}

fn map_rotor4d(euler: vec3<f32>) -> vec3<f32> {
  return euler * 0.5;
}

@compute @workgroup_size({{WORKGROUP_SIZE}}, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (index >= arrayLength(&inputQuats.values)) {
    return;
  }

  let normalized = quat_normalize(inputQuats.values[index]);
  let matrix = quat_to_matrix(normalized);
  let euler = quat_to_euler(normalized);
  let rotor4d = map_rotor4d(euler);

  outputRotors.values[index] = RotorSample(
    matrix,
    vec4<f32>(rotor4d, 0.0),
    vec4<f32>(euler, 0.0)
  );
}
`;

export class QuaternionRotorCompute {
  static readonly wgslSource = ROTOR_COMPUTE_TEMPLATE.replace('{{WORKGROUP_SIZE}}', DEFAULT_WORKGROUP_SIZE.toString());

  readonly device: GPUComputeDeviceLike;
  readonly workgroupSize: number;
  readonly maxInstances: number;
  readonly label: string;
  readonly source: string;

  readonly shaderModule: GPUShaderModuleLike;
  readonly pipeline: GPUComputePipelineLike;
  readonly bindGroup: GPUBindGroupLike;
  readonly inputBuffer: GPUBufferLike;
  readonly outputBuffer: GPUBufferLike;

  private readonly inputBufferSize: number;
  private readonly outputBufferSize: number;

  constructor(options: QuaternionRotorComputeOptions) {
    if (!options?.device) {
      throw new Error('QuaternionRotorCompute requires a WebGPU device');
    }
    if (!Number.isFinite(options.maxInstances) || options.maxInstances <= 0) {
      throw new Error('QuaternionRotorCompute maxInstances must be a positive number');
    }

    this.device = options.device;
    this.maxInstances = Math.floor(options.maxInstances);
    this.workgroupSize = Math.max(1, Math.floor(options.workgroupSize ?? DEFAULT_WORKGROUP_SIZE));
    this.label = options.label ?? 'QuaternionRotorCompute';

    this.source = ROTOR_COMPUTE_TEMPLATE.replace('{{WORKGROUP_SIZE}}', this.workgroupSize.toString());
    this.shaderModule = this.device.createShaderModule({ code: this.source, label: `${this.label}-shader` });
    this.pipeline = this.device.createComputePipeline({
      label: `${this.label}-pipeline`,
      compute: { module: this.shaderModule, entryPoint: 'main' }
    });

    this.inputBufferSize = this.maxInstances * 4 * Float32Array.BYTES_PER_ELEMENT;
    this.outputBufferSize = this.maxInstances * 24 * Float32Array.BYTES_PER_ELEMENT;

    this.inputBuffer = this.device.createBuffer({
      size: this.inputBufferSize,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
      label: `${this.label}-input`
    });

    this.outputBuffer = this.device.createBuffer({
      size: this.outputBufferSize,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_SRC,
      label: `${this.label}-output`
    });

    const layout = this.pipeline.getBindGroupLayout(0);
    this.bindGroup = this.device.createBindGroup({
      label: `${this.label}-bind-group`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.inputBuffer } },
        { binding: 1, resource: { buffer: this.outputBuffer } }
      ]
    });
  }

  updateInput(data: ArrayBufferView | ArrayBuffer): void {
    const byteLength = data instanceof ArrayBuffer ? data.byteLength : (data as ArrayBufferView).byteLength;
    if (byteLength > this.inputBufferSize) {
      throw new Error('QuaternionRotorCompute.updateInput data exceeds input buffer capacity');
    }
    this.device.queue.writeBuffer(this.inputBuffer, 0, data);
  }

  dispatch(encoder: GPUCommandEncoderLike, instanceCount: number): void {
    if (!Number.isFinite(instanceCount) || instanceCount < 0) {
      throw new Error('QuaternionRotorCompute.dispatch requires a non-negative instance count');
    }
    if (instanceCount === 0) {
      return;
    }
    if (instanceCount > this.maxInstances) {
      throw new Error('QuaternionRotorCompute.dispatch instance count exceeds the configured capacity');
    }

    const groups = Math.ceil(instanceCount / this.workgroupSize);
    const pass = encoder.beginComputePass({ label: `${this.label}-pass` });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
  }

  process(encoder: GPUCommandEncoderLike, data: ArrayBufferView | ArrayBuffer, instanceCount: number): void {
    this.updateInput(data);
    this.dispatch(encoder, instanceCount);
  }

  getInputBuffer(): GPUBufferLike {
    return this.inputBuffer;
  }

  getOutputBuffer(): GPUBufferLike {
    return this.outputBuffer;
  }

  static cpuProject(quaternions: ArrayLike<number>): Float32Array {
    const sampleCount = Math.floor(quaternions.length / 4);
    const output = new Float32Array(sampleCount * 24);
    for (let i = 0; i < sampleCount; i += 1) {
      const base = i * 4;
      const q: [number, number, number, number] = [
        Number(quaternions[base + 0]) || 0,
        Number(quaternions[base + 1]) || 0,
        Number(quaternions[base + 2]) || 0,
        Number(quaternions[base + 3]) || 0
      ];
      const snapshot = deriveSnapshot(q);
      const outBase = i * 24;
      for (let j = 0; j < 16; j += 1) {
        output[outBase + j] = snapshot.matrix4[j];
      }
      output[outBase + 16] = snapshot.rotor4d[0];
      output[outBase + 17] = snapshot.rotor4d[1];
      output[outBase + 18] = snapshot.rotor4d[2];
      output[outBase + 19] = 0;
      output[outBase + 20] = snapshot.euler[0];
      output[outBase + 21] = snapshot.euler[1];
      output[outBase + 22] = snapshot.euler[2];
      output[outBase + 23] = 0;
    }
    return output;
  }
}

import { deriveRotorSnapshot, normalize as normalizeQuaternionTuple } from '../../../../core/quaternion/index.ts';
import type { Quaternion } from '../../../../core/quaternion/index.ts';

type QuaternionTuple = readonly [number, number, number, number];

interface RotorSnapshot {
  matrix4: number[];
  euler: [number, number, number];
  rotor4d: [number, number, number];
}

function deriveSnapshot(source: QuaternionTuple): RotorSnapshot {
  const normalized = normalizeQuaternionTuple(source) as Quaternion;
  return deriveRotorSnapshot(normalized);
}

export { deriveSnapshot as deriveRotorSnapshotCPU };
