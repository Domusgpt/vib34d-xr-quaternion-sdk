import {
  IDENTITY_QUATERNION,
  type EulerAngles,
  type Quaternion,
  deriveRotorSnapshot,
  normalize as normalizeQuaternion,
  quaternionToEuler,
} from '../../../core/quaternion/index.ts';

export interface RotorMeasurement {
  readonly quaternion: Quaternion;
  readonly rotor?: readonly [number, number, number];
  readonly timestamp: number;
}

export interface PredictiveRotorState {
  readonly quaternion: Quaternion;
  readonly rotor: readonly [number, number, number];
  readonly euler: EulerAngles;
  readonly velocity: readonly [number, number, number];
  readonly timestamp: number;
  readonly confidence: number;
  readonly horizon: number;
  readonly latency: number;
}

export interface PredictiveRotorCacheOptions {
  readonly measurementNoise?: number;
  readonly processNoise?: number;
  readonly predictionHorizon?: number;
  readonly maxLatency?: number;
}

interface AxisState {
  angle: number;
  velocity: number;
  covariance: [number, number, number, number];
  lastAngle: number;
}

const TWO_PI = Math.PI * 2;

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) {
    result -= TWO_PI;
  }
  while (result < -Math.PI) {
    result += TWO_PI;
  }
  return result;
}

function unwrapAngle(measurement: number, previous: number): number {
  let diff = measurement - previous;
  if (!Number.isFinite(diff)) {
    return measurement;
  }
  while (diff > Math.PI) {
    measurement -= TWO_PI;
    diff = measurement - previous;
  }
  while (diff < -Math.PI) {
    measurement += TWO_PI;
    diff = measurement - previous;
  }
  return measurement;
}

class KalmanAxisFilter {
  private readonly measurementNoise: number;
  private readonly processNoise: number;
  private state: AxisState = {
    angle: 0,
    velocity: 0,
    covariance: [1, 0, 0, 1],
    lastAngle: 0,
  };
  private initialized = false;

  constructor(options: { measurementNoise: number; processNoise: number }) {
    this.measurementNoise = Math.max(1e-5, options.measurementNoise);
    this.processNoise = Math.max(1e-5, options.processNoise);
  }

  update(measurement: number, dt: number): AxisState {
    if (!this.initialized || !Number.isFinite(this.state.angle)) {
      this.state = {
        angle: measurement,
        velocity: 0,
        covariance: [1, 0, 0, 1],
        lastAngle: measurement,
      };
      this.initialized = true;
      return this.state;
    }

    const clampedDt = Math.max(0, Math.min(dt, 0.25));
    const { angle, velocity, covariance } = this.state;
    const [p00, p01, p10, p11] = covariance;

    const predictedAngle = angle + velocity * clampedDt;
    const predictedVelocity = velocity;
    const f00 = 1;
    const f01 = clampedDt;
    const f10 = 0;
    const f11 = 1;

    const qAngle = this.processNoise * clampedDt * clampedDt * 0.5;
    const qVelocity = this.processNoise * clampedDt;

    const n00 = f00 * p00 + f01 * p10;
    const n01 = f00 * p01 + f01 * p11;
    const n10 = f10 * p00 + f11 * p10;
    const n11 = f10 * p01 + f11 * p11;

    let cov00 = n00 * f00 + n01 * f10 + qAngle;
    let cov01 = n00 * f01 + n01 * f11;
    let cov10 = n10 * f00 + n11 * f10;
    let cov11 = n10 * f01 + n11 * f11 + qVelocity;

    const measurementUnwrapped = unwrapAngle(measurement, this.state.lastAngle);
    this.state.lastAngle = measurementUnwrapped;
    const innovation = normalizeAngle(measurementUnwrapped - predictedAngle);

    const h0 = 1;
    const h1 = 0;
    const innovationVariance = cov00 * h0 * h0 + this.measurementNoise;
    const kalman0 = (cov00 * h0 + cov01 * h1) / innovationVariance;
    const kalman1 = (cov10 * h0 + cov11 * h1) / innovationVariance;

    const correctedAngle = predictedAngle + kalman0 * innovation;
    const correctedVelocity = predictedVelocity + kalman1 * innovation;

    const identity00 = 1 - kalman0 * h0;
    const identity01 = -kalman0 * h1;
    const identity10 = -kalman1 * h0;
    const identity11 = 1 - kalman1 * h1;

    cov00 = identity00 * cov00 + identity01 * cov10;
    cov01 = identity00 * cov01 + identity01 * cov11;
    cov10 = identity10 * cov00 + identity11 * cov10;
    cov11 = identity10 * cov01 + identity11 * cov11;

    this.state = {
      angle: correctedAngle,
      velocity: correctedVelocity,
      covariance: [cov00, cov01, cov10, cov11],
      lastAngle: measurementUnwrapped,
    };

    return this.state;
  }

  forecast(dt: number): AxisState {
    const clampedDt = Math.max(0, Math.min(dt, 0.25));
    const { angle, velocity, covariance, lastAngle } = this.state;
    const predictedAngle = normalizeAngle(angle + velocity * clampedDt);
    const predictedVelocity = velocity;

    const [p00, p01, p10, p11] = covariance;
    const f00 = 1;
    const f01 = clampedDt;
    const f10 = 0;
    const f11 = 1;

    const qAngle = this.processNoise * clampedDt * clampedDt * 0.5;
    const qVelocity = this.processNoise * clampedDt;

    const n00 = f00 * p00 + f01 * p10;
    const n01 = f00 * p01 + f01 * p11;
    const n10 = f10 * p00 + f11 * p10;
    const n11 = f10 * p01 + f11 * p11;

    return {
      angle: predictedAngle,
      velocity: predictedVelocity,
      covariance: [
        n00 * f00 + n01 * f10 + qAngle,
        n00 * f01 + n01 * f11,
        n10 * f00 + n11 * f10,
        n10 * f01 + n11 * f11 + qVelocity,
      ],
      lastAngle,
    };
  }
}

function eulerToQuaternion(euler: EulerAngles): Quaternion {
  const [roll, pitch, yaw] = euler;
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return normalizeQuaternion([
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ]);
}

export class PredictiveRotorCache {
  private readonly filters: [KalmanAxisFilter, KalmanAxisFilter, KalmanAxisFilter];
  private readonly predictionHorizon: number;
  private readonly maxLatency: number;
  private lastTimestamp: number | null = null;
  private lastState: PredictiveRotorState | null = null;

  constructor(options: PredictiveRotorCacheOptions = {}) {
    const measurementNoise = Math.max(1e-4, options.measurementNoise ?? 0.015);
    const processNoise = Math.max(1e-4, options.processNoise ?? 0.035);
    this.predictionHorizon = Math.max(0.002, options.predictionHorizon ?? 0.011);
    this.maxLatency = Math.max(0.002, options.maxLatency ?? 0.08);
    this.filters = [
      new KalmanAxisFilter({ measurementNoise, processNoise }),
      new KalmanAxisFilter({ measurementNoise, processNoise }),
      new KalmanAxisFilter({ measurementNoise, processNoise }),
    ];
  }

  ingest(measurement: RotorMeasurement): PredictiveRotorState {
    const timestamp = Number.isFinite(measurement.timestamp) ? measurement.timestamp : 0;
    const dt = this.lastTimestamp == null ? 0 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    const normalized = normalizeQuaternion(measurement.quaternion ?? IDENTITY_QUATERNION);
    const euler = quaternionToEuler(normalized);

    const axisStates = this.filters.map((filter, index) => filter.update(euler[index] ?? 0, dt)) as [
      AxisState,
      AxisState,
      AxisState,
    ];

    const forecastState = this.forecast(this.predictionHorizon);
    const predicted = forecastState ?? {
      quaternion: normalized,
      rotor: measurement.rotor ?? deriveRotorSnapshot(normalized).rotor4d,
      euler,
      velocity: axisStates.map(axis => axis.velocity) as [number, number, number],
      timestamp,
      confidence: 0.5,
      horizon: 0,
      latency: 0,
    };

    this.lastState = predicted;
    return predicted;
  }

  forecast(deltaTime: number): PredictiveRotorState | null {
    if (this.lastTimestamp == null) {
      return null;
    }

    const horizon = Math.max(0, Math.min(deltaTime, this.maxLatency));
    const axisStates = this.filters.map(filter => filter.forecast(horizon)) as [
      AxisState,
      AxisState,
      AxisState,
    ];

    const euler: EulerAngles = [axisStates[0].angle, axisStates[1].angle, axisStates[2].angle];
    const quaternion = eulerToQuaternion(euler);
    const rotor = deriveRotorSnapshot(quaternion).rotor4d;
    const velocity = axisStates.map(axis => axis.velocity) as [number, number, number];
    const variance = axisStates.reduce((sum, axis) => sum + Math.abs(axis.covariance[0]), 0) / axisStates.length;
    const confidence = clamp01(Math.exp(-variance * 4));

    const state: PredictiveRotorState = {
      quaternion,
      rotor,
      euler,
      velocity,
      timestamp: this.lastTimestamp + horizon,
      confidence,
      horizon,
      latency: horizon,
    };

    this.lastState = state;
    return state;
  }

  getLastPrediction(): PredictiveRotorState | null {
    return this.lastState;
  }
}

export default PredictiveRotorCache;
