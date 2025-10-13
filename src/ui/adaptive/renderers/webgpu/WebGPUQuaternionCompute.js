import {
  dualQuaternionToMatrix,
  normalizeQuaternionObject,
} from '../../../../core/quaternion/index.js';

const DEFAULT_WORKGROUP_SIZE = 64;
const FALLBACK_SHADER_STAGE = { COMPUTE: 4 };

function resolveShaderStage(flag) {
  if (typeof GPUShaderStage !== 'undefined' && GPUShaderStage && flag in GPUShaderStage) {
    return GPUShaderStage[flag];
  }
  return FALLBACK_SHADER_STAGE[flag];
}

function ensureDevice(device) {
  if (!device || typeof device !== 'object') {
    throw new Error('WebGPUQuaternionCompute requires a GPU device instance.');
  }
  return device;
}

function createMatrixFromQuaternion(quaternion, target = new Float32Array(16)) {
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

  target[0] = 1 - 2 * (yy + zz);
  target[1] = 2 * (xy - wz);
  target[2] = 2 * (xz + wy);
  target[3] = 0;

  target[4] = 2 * (xy + wz);
  target[5] = 1 - 2 * (xx + zz);
  target[6] = 2 * (yz - wx);
  target[7] = 0;

  target[8] = 2 * (xz - wy);
  target[9] = 2 * (yz + wx);
  target[10] = 1 - 2 * (xx + yy);
  target[11] = 0;

  target[12] = 0;
  target[13] = 0;
  target[14] = 0;
  target[15] = 1;
  return target;
}

function createDefaultShaderModule(device, label) {
  if (typeof device.createShaderModule !== 'function') {
    return null;
  }

  const code = /* wgsl */`
struct Params {
  count : u32,
};

@group(0) @binding(0) var<storage, read> inputQuaternions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> outputMatrices : array<mat4x4<f32>>;
@group(0) @binding(2) var<uniform> params : Params;

@compute @workgroup_size(${DEFAULT_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let index = gid.x;
  if (index >= params.count) {
    return;
  }

  let q = inputQuaternions[index];
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

  outputMatrices[index] = mat4x4<f32>(
    vec4<f32>(1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy), 0.0),
    vec4<f32>(2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx), 0.0),
    vec4<f32>(2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy), 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}
`;

  return device.createShaderModule({ code, label: `${label}-module` });
}

export class WebGPUQuaternionCompute {
  constructor(device, options = {}) {
    this.device = ensureDevice(device);
    this.label = options.label || 'webgpu-quaternion-compute';
    this.workgroupSize = Math.max(1, Math.floor(options.workgroupSize || DEFAULT_WORKGROUP_SIZE));
    this.enableCompute = options.enableCompute !== false;

    this.pipeline = null;
    this.pipelineLayout = null;
    this.bindGroupLayout = null;

    if (this.enableCompute && typeof this.device.createComputePipeline === 'function') {
      this.initializePipeline(options);
    }
  }

  initializePipeline(options = {}) {
    if (typeof this.device.createBindGroupLayout !== 'function' ||
        typeof this.device.createPipelineLayout !== 'function') {
      return;
    }

    const visibility = resolveShaderStage('COMPUTE');

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}-bind-group-layout`,
      entries: [
        {
          binding: 0,
          visibility,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility,
          buffer: { type: 'storage' },
        },
        {
          binding: 2,
          visibility,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this.pipelineLayout = this.device.createPipelineLayout({
      label: `${this.label}-pipeline-layout`,
      bindGroupLayouts: [this.bindGroupLayout],
    });

    const shaderModule = options.shaderModule || createDefaultShaderModule(this.device, this.label);
    if (!shaderModule) {
      return;
    }

    this.pipeline = this.device.createComputePipeline({
      label: this.label,
      layout: this.pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: options.entryPoint || 'main',
      },
    });
  }

  matrixForQuaternion(quaternion, options = {}) {
    const normalized = options.normalized ? quaternion : normalizeQuaternionObject(quaternion);
    const target = options.target instanceof Float32Array && options.target.length >= 16
      ? options.target
      : new Float32Array(16);
    return createMatrixFromQuaternion(normalized, target);
  }

  matrixBatchForQuaternions(quaternions, options = {}) {
    const count = Array.isArray(quaternions) ? quaternions.length : 0;
    const target = options.target instanceof Float32Array && options.target.length >= count * 16
      ? options.target
      : new Float32Array(Math.max(16, count * 16));

    for (let index = 0; index < count; index += 1) {
      const quaternion = options.normalized
        ? quaternions[index]
        : normalizeQuaternionObject(quaternions[index]);
      createMatrixFromQuaternion(quaternion, target.subarray(index * 16, index * 16 + 16));
    }

    return target;
  }

  matrixForDualQuaternion(dualQuaternion, options = {}) {
    const target = options.target instanceof Float32Array && options.target.length >= 16
      ? options.target
      : new Float32Array(16);
    return dualQuaternionToMatrix(dualQuaternion, { normalized: options.normalized, target });
  }

  matrixBatchForDualQuaternions(dualQuaternions, options = {}) {
    const count = Array.isArray(dualQuaternions) ? dualQuaternions.length : 0;
    const target = options.target instanceof Float32Array && options.target.length >= count * 16
      ? options.target
      : new Float32Array(Math.max(16, count * 16));

    for (let index = 0; index < count; index += 1) {
      const slice = target.subarray(index * 16, index * 16 + 16);
      dualQuaternionToMatrix(dualQuaternions[index], { normalized: options.normalized, target: slice });
    }

    return target;
  }

  encode(commandEncoder, bindGroup, count, label = `${this.label}-pass`) {
    if (!this.pipeline) {
      throw new Error('Compute pipeline is not available on this device.');
    }
    if (!commandEncoder || typeof commandEncoder.beginComputePass !== 'function') {
      throw new Error('encode requires a GPUCommandEncoder capable of beginComputePass.');
    }
    if (!bindGroup) {
      throw new Error('encode requires a bind group that matches the compute layout.');
    }

    const workgroups = Math.max(1, Math.ceil((Number(count) || 0) / this.workgroupSize));
    const pass = commandEncoder.beginComputePass({ label });
    if (typeof pass.setPipeline === 'function') {
      pass.setPipeline(this.pipeline);
    }
    if (typeof pass.setBindGroup === 'function') {
      pass.setBindGroup(0, bindGroup);
    }
    if (typeof pass.dispatchWorkgroups === 'function') {
      pass.dispatchWorkgroups(workgroups);
    }
    pass.end?.();
    return workgroups;
  }
}

export default WebGPUQuaternionCompute;
