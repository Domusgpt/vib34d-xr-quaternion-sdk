import { describe, expect, it } from 'vitest';

import { PolychoraSystem } from '../src/core/PolychoraSystem.js';
import EnhancedPolychoraSystem from '../src/core/EnhancedPolychoraSystem.js';
import { fromAxisAngle } from '../src/core/quaternion/index.ts';

function createEnhancedStub() {
  const instance = Object.create(EnhancedPolychoraSystem.prototype);
  instance.rotorState = { xy: 0, xz: 0, yz: 0, xw: 0, yw: 0, zw: 0 };
  instance.rotationAngles = { XY: 0, XZ: 0, YZ: 0, XW: 0, YW: 0, ZW: 0 };
  return instance as EnhancedPolychoraSystem & {
    rotorState: Required<EnhancedPolychoraSystem['rotorState']>;
    rotationAngles: Record<string, number>;
  };
}

describe('Polychora quaternion integration', () => {
  it('maps quaternion snapshots to rotor parameters for PolychoraSystem', () => {
    const system = new PolychoraSystem();
    const quaternion = fromAxisAngle([0, 1, 0], Math.PI / 2);

    system.setQuaternionRotation(quaternion);

    expect(system.parameters.rot4dYW).toBeCloseTo(Math.PI / 4, 3);
    expect(system.parameters.rot4dXY).toBeCloseTo(0, 6);
    expect(system.parameters.rot4dXZ).toBeCloseTo(-Math.PI / 2, 3);
    expect(system.getRotorState().xw).toBeCloseTo(system.parameters.rot4dXW, 6);
  });

  it('applies rotor arrays consistently', () => {
    const system = new PolychoraSystem();
    system.applyRotorState([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);

    expect(system.parameters.rot4dXY).toBeCloseTo(0.1);
    expect(system.parameters.rot4dZW).toBeCloseTo(0.6);
  });

  it('updates enhanced system rotation angles from quaternion snapshots', () => {
    const enhanced = createEnhancedStub();
    const quaternion = fromAxisAngle([1, 0, 0], Math.PI / 3);

    enhanced.setQuaternionRotation(quaternion);

    expect(enhanced.rotationAngles.XY).toBeCloseTo(0, 6);
    expect(enhanced.rotationAngles.XZ).toBeCloseTo(0, 6);
    expect(enhanced.rotationAngles.YZ).toBeCloseTo(Math.PI / 3, 3);
    expect(enhanced.rotationAngles.XW).toBeCloseTo(enhanced.rotorState.xw, 6);
  });
});
