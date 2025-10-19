import { bench, describe } from 'vitest';

import { QuaternionRotorCompute } from '../src/ui/adaptive/renderers/webgpu/QuaternionRotorCompute.ts';
import { deriveRotorSnapshot, fromAxisAngle } from '../src/core/quaternion/index.ts';
import { createMockDevice, createMockEncoder } from './utils/mockWebGPU';

const SAMPLE_COUNT = 64;
const quaternionSamples = new Float32Array(SAMPLE_COUNT * 4);
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  const axis = [Math.sin(i * 0.17), Math.cos(i * 0.23), Math.sin(i * 0.13)] as const;
  const angle = (i + 1) * 0.01 * Math.PI;
  const quaternion = fromAxisAngle(axis, angle);
  quaternionSamples.set(quaternion, i * 4);
}

describe('Rotor compute CPU vs GPU baselines', () => {
  const device = createMockDevice();
  const compute = new QuaternionRotorCompute({ device, maxInstances: SAMPLE_COUNT, workgroupSize: 32, label: 'bench' });

  bench('CPU deriveRotorSnapshot', () => {
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const slice = quaternionSamples.subarray(i * 4, i * 4 + 4) as unknown as [number, number, number, number];
      deriveRotorSnapshot(slice);
    }
  });

  bench('WebGPU rotor dispatch (mocked)', () => {
    const encoder = createMockEncoder();
    compute.process(encoder, quaternionSamples, SAMPLE_COUNT);
  });
});
