import { describe, it, expect } from 'vitest';
import {
  IDENTITY_QUATERNION,
  deriveRotorSnapshot,
  fromAxisAngle,
  type Quaternion,
} from '../src/core/quaternion/index.ts';
import PredictiveRotorCache from '../src/ui/adaptive/localization/PredictiveRotorCache.ts';

const Y_AXIS: [number, number, number] = [0, 1, 0];

describe('PredictiveRotorCache', () => {
  it('forecasts forward orientation for steady rotation', () => {
    const cache = new PredictiveRotorCache({ measurementNoise: 0.002, processNoise: 0.02 });
    const dt = 1 / 90;
    const angularVelocity = 0.9; // radians per second

    for (let i = 0; i < 96; i += 1) {
      const time = i * dt;
      const angle = angularVelocity * time;
      const quaternion = fromAxisAngle(Y_AXIS, angle) as Quaternion;
      cache.ingest({ quaternion, timestamp: time });
    }

    const prediction = cache.forecast(dt);
    expect(prediction).not.toBeNull();
    if (!prediction) {
      return;
    }

    const futureTime = 96 * dt;
    const expectedQuat = fromAxisAngle(Y_AXIS, angularVelocity * futureTime) as Quaternion;
    const expectedRotor = deriveRotorSnapshot(expectedQuat).rotor4d;
    expect(Math.abs(prediction.rotor[0] - expectedRotor[0])).toBeLessThan(0.2);
    expect(Math.abs(prediction.rotor[1] - expectedRotor[1])).toBeLessThan(0.2);
    expect(Math.abs(prediction.rotor[2] - expectedRotor[2])).toBeLessThan(0.2);
    expect(prediction.confidence).toBeGreaterThan(0.35);
    expect(prediction.horizon).toBeCloseTo(dt, 3);
  });

  it('provides last prediction snapshot', () => {
    const cache = new PredictiveRotorCache();
    cache.ingest({ quaternion: IDENTITY_QUATERNION, timestamp: 0 });
    const predicted = cache.forecast(0.02);
    expect(predicted).not.toBeNull();
    expect(cache.getLastPrediction()).toEqual(predicted);
  });
});
