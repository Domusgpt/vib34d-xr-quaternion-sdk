import { bench, describe } from 'vitest';

import {
  IDENTITY_QUATERNION,
  blendDualQuaternionArray,
  composeRotorFromDualQuaternion,
  dualQuaternionFromRotationTranslation,
  fromAxisAngle,
  rotorToDualQuaternion,
  slerp
} from '../src/core/quaternion/index.ts';

const baseA = fromAxisAngle([0.1, 0.3, -0.2], Math.PI * 0.45);
const baseB = fromAxisAngle([-0.25, 0.6, 0.15], Math.PI * 0.2);

const blendSamples = new Array(8).fill(0).map((_, index) =>
  dualQuaternionFromRotationTranslation(
    fromAxisAngle([Math.sin(index), Math.cos(index * 0.5), Math.sin(index * 0.33)], 0.1 * (index + 1)),
    [index * 0.01, -index * 0.015, index * 0.005]
  )
);

const blendWeights = blendSamples.map((_, index) => 1 / (index + 1));

describe('Quaternion performance baselines', () => {
  bench('slerp interpolation', () => {
    slerp(baseA, baseB, 0.37);
  });

  bench('dual quaternion blending', () => {
    blendDualQuaternionArray(blendSamples, blendWeights);
  });

  bench('rotor conversion pipeline', () => {
    const dq = dualQuaternionFromRotationTranslation(baseA, [0.05, 0.1, -0.02]);
    const rotor = composeRotorFromDualQuaternion(dq);
    const reconstructed = rotorToDualQuaternion(rotor);
    blendDualQuaternionArray([reconstructed, dq, dualQuaternionFromRotationTranslation(IDENTITY_QUATERNION, [0, 0, 0])], [0.2, 0.5, 0.3]);
  });
});
