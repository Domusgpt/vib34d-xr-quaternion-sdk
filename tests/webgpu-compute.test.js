import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGPUQuaternionCompute } from '../src/ui/adaptive/renderers/webgpu/WebGPUQuaternionCompute.js';

function createMinimalDevice(overrides = {}) {
  return {
    queue: {},
    ...overrides,
  };
}

test('matrixForQuaternion matches analytic CPU conversion', () => {
  const device = createMinimalDevice();
  const compute = new WebGPUQuaternionCompute(device, { enableCompute: false });

  const sqrtHalf = Math.sqrt(0.5);
  const matrix = compute.matrixForQuaternion({ x: sqrtHalf, y: 0, z: 0, w: sqrtHalf });

  assert.equal(matrix.length, 16);
  assert.ok(Math.abs(matrix[0] - 1) < 1e-6);
  assert.ok(Math.abs(matrix[5]) < 1e-6);
  assert.ok(Math.abs(matrix[6] + 1) < 1e-6);
  assert.ok(Math.abs(matrix[9] - 1) < 1e-6);
  assert.ok(Math.abs(matrix[10]) < 1e-6);
});

test('initializes compute pipeline when device supports compute', () => {
  let createdShader = null;
  let createdPipeline = null;
  const device = createMinimalDevice({
    createBindGroupLayout(descriptor) {
      return descriptor;
    },
    createPipelineLayout(descriptor) {
      return descriptor;
    },
    createShaderModule(descriptor) {
      createdShader = descriptor;
      return { descriptor };
    },
    createComputePipeline(descriptor) {
      createdPipeline = descriptor;
      return { descriptor };
    },
  });

  const compute = new WebGPUQuaternionCompute(device);

  assert.ok(createdShader?.code.includes('outputMatrices'));
  assert.equal(createdPipeline.layout, compute.pipelineLayout);
  assert.equal(compute.bindGroupLayout.entries.length, 3);
  assert.ok(compute.pipeline);
});

test('encode dispatches expected workgroup count', () => {
  const passCommands = [];
  const pass = {
    setPipeline(pipeline) {
      passCommands.push({ type: 'pipeline', pipeline });
    },
    setBindGroup(index, group) {
      passCommands.push({ type: 'bindGroup', index, group });
    },
    dispatchWorkgroups(count) {
      passCommands.push({ type: 'dispatch', count });
    },
    end() {
      passCommands.push({ type: 'end' });
    },
  };

  const device = createMinimalDevice({
    createBindGroupLayout() {
      return {};
    },
    createPipelineLayout() {
      return {};
    },
    createShaderModule() {
      return {};
    },
    createComputePipeline(descriptor) {
      return { descriptor };
    },
  });

  const compute = new WebGPUQuaternionCompute(device);
  const commandEncoder = {
    beginComputePass() {
      return pass;
    },
  };

  const bindGroup = { label: 'bind-group' };
  const workgroups = compute.encode(commandEncoder, bindGroup, 130);

  assert.equal(workgroups, 3); // ceil(130 / 64)
  const dispatch = passCommands.find((command) => command.type === 'dispatch');
  assert.equal(dispatch.count, workgroups);
});

test('matrixBatchForQuaternions reuses target buffer', () => {
  const device = createMinimalDevice();
  const compute = new WebGPUQuaternionCompute(device, { enableCompute: false });
  const target = new Float32Array(32);
  const quaternions = [
    { x: 0, y: 0, z: 0, w: 1 },
    { x: 0, y: 1, z: 0, w: 0 },
  ];

  const result = compute.matrixBatchForQuaternions(quaternions, { target });
  assert.strictEqual(result, target);
  assert.equal(result.length, 32);
});
