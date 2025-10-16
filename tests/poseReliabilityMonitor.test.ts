import { describe, expect, it } from 'vitest';

import { QuaternionPoseRegistry } from '../src/core/quaternion/registry.ts';
import { PoseReliabilityMonitor } from '../src/ui/adaptive/renderers/PoseReliabilityMonitor.ts';

type TelemetryEvent = {
  event: string;
  payload?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

class StubTelemetry {
  public readonly events: TelemetryEvent[] = [];

  track(event: string, payload?: Record<string, unknown>, meta?: Record<string, unknown>) {
    this.events.push({ event, payload, meta });
  }
}

const BASE_HEAD = {
  id: 'headset-primary',
  role: 'headset' as const,
  handedness: 'none' as const,
  timestamp: 0,
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  position: { x: 0, y: 0, z: 0 },
  reliability: 'tracked' as const,
  accuracy: 0.02,
};

const createFrame = ({
  frameId = `frame-${Math.random().toString(16).slice(2)}`,
  timestamp = 0,
  head = BASE_HEAD,
}: {
  frameId?: string;
  timestamp?: number;
  head?: typeof BASE_HEAD & {
    orientation?: { x: number; y: number; z: number; w: number };
    position?: { x: number; y: number; z: number };
    reliability?: 'tracked' | 'estimated' | 'unavailable';
    accuracy?: number;
    linearVelocity?: { x: number; y: number; z: number };
    angularVelocity?: { x: number; y: number; z: number };
  };
}) => ({
  frameId,
  timestamp,
  referenceSpace: 'local' as const,
  head: {
    ...BASE_HEAD,
    ...head,
  },
  controllers: [],
  hands: [],
});

describe('PoseReliabilityMonitor', () => {
  it('flags degraded headset confidence and emits telemetry', () => {
    const registry = new QuaternionPoseRegistry();
    const telemetry = new StubTelemetry();
    let currentTime = 0;

    registry.ingestFrame(
      createFrame({
        timestamp: 0,
        head: {
          reliability: 'estimated',
          accuracy: 0.5,
          linearVelocity: { x: 3, y: 0, z: 0 },
          angularVelocity: { x: 2.5, y: 0, z: 0 },
        },
      })
    );

    const monitor = new PoseReliabilityMonitor({
      registry,
      telemetry: telemetry as unknown as any,
      autoStart: false,
      now: () => currentTime,
    });

    const snapshots = monitor.evaluate();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.status).toBe('degraded');

    expect(telemetry.events.map(event => event.event)).toContain('sensors.pose.degraded');
    const payload = telemetry.events.find(event => event.event === 'sensors.pose.degraded')?.payload;
    expect(payload?.confidence as number).toBeLessThan(0.55);
  });

  it('emits stale and recovered telemetry events as pose data ages and refreshes', () => {
    const registry = new QuaternionPoseRegistry();
    const telemetry = new StubTelemetry();
    let currentTime = 0;

    registry.ingestFrame(createFrame({ timestamp: 0 }));

    const monitor = new PoseReliabilityMonitor({
      registry,
      telemetry: telemetry as unknown as any,
      autoStart: false,
      now: () => currentTime,
    });

    monitor.evaluate();
    expect(telemetry.events.length).toBe(0);

    currentTime = 220;
    monitor.evaluate();

    expect(telemetry.events.at(-1)?.event).toBe('sensors.pose.stale');

    telemetry.events.length = 0;
    registry.ingestFrame(createFrame({ timestamp: currentTime }));
    monitor.evaluate();

    expect(telemetry.events.map(event => event.event)).toContain('sensors.pose.recovered');
    const state = monitor.getCurrentStates()[0];
    expect(state.status).toBe('healthy');
  });

  it('records lost devices when registry entries are pruned', () => {
    const registry = new QuaternionPoseRegistry({ retentionMs: 50 });
    const telemetry = new StubTelemetry();
    let currentTime = 0;

    registry.ingestFrame(createFrame({ timestamp: 0 }));

    const monitor = new PoseReliabilityMonitor({
      registry,
      telemetry: telemetry as unknown as any,
      autoStart: false,
      now: () => currentTime,
    });

    monitor.evaluate();
    currentTime = 200;
    registry.prune(currentTime);
    telemetry.events.length = 0;

    monitor.evaluate();
    expect(telemetry.events.map(event => event.event)).toContain('sensors.pose.lost');
    expect(monitor.getCurrentStates()[0]?.status).toBe('lost');
  });
});
