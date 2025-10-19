import { describe, expect, it } from 'vitest';

import { QuaternionPoseRegistry } from '../src/core/quaternion/registry.ts';
import { ShaderQuaternionSynchronizer } from '../src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { QuaternionPoseRegistrySynchronizer } from '../src/ui/adaptive/renderers/QuaternionPoseRegistrySynchronizer.ts';

class MockBridge {
  subscribe() {
    return () => {};
  }
}

class MockSystem {
  private readonly parameters = new Map<string, number>();

  constructor(initial: Record<string, number>) {
    for (const [key, value] of Object.entries(initial)) {
      this.parameters.set(key, value);
    }
  }

  updateParameter(key: string, value: number) {
    this.parameters.set(key, value);
  }

  getParameter(key: string) {
    return this.parameters.get(key) ?? 0;
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

const identityFrame = (overrides: Partial<ReturnType<typeof createFrame>> = {}) =>
  createFrame({
    timestamp: overrides.timestamp ?? 0,
    head: {
      ...BASE_HEAD,
      ...(overrides.head ?? {}),
    },
    controllers: overrides.controllers ?? [],
  });

function createFrame({
  frameId = `frame-${Math.random().toString(16).slice(2)}`,
  timestamp = 0,
  head = BASE_HEAD,
  controllers = [],
}: {
  frameId?: string;
  timestamp?: number;
  head?: typeof BASE_HEAD & { orientation?: { x: number; y: number; z: number; w: number } };
  controllers?: any[];
}) {
  return {
    frameId,
    timestamp,
    referenceSpace: 'local',
    head,
    controllers,
    hands: [],
  };
}

function createController(id: string, {
  orientation,
  reliability = 'tracked' as const,
  accuracy = 0.03,
  handedness = 'right' as const,
  timestamp = 0,
}: {
  orientation: { x: number; y: number; z: number; w: number };
  reliability?: 'tracked' | 'estimated' | 'unavailable';
  accuracy?: number;
  handedness?: 'left' | 'right';
  timestamp?: number;
}) {
  return {
    id,
    role: 'controller' as const,
    handedness,
    timestamp,
    orientation,
    position: { x: 0, y: 0, z: 0 },
    reliability,
    accuracy,
    buttons: [],
    triggers: [],
  };
}

describe('QuaternionPoseRegistrySynchronizer', () => {
  it('streams headset quaternions from the registry into the shader synchronizer', () => {
    const registry = new QuaternionPoseRegistry();
    const bridge = new MockBridge();
    const quantum = new MockSystem({ rot4dYW: 0, rot4dXW: 0, rot4dZW: 0 });

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum },
      rotationScale: 1,
      baseAlpha: 1,
      minConfidence: 0,
      energySmoothing: 1,
      velocityReference: 1,
      autoExclusiveActivation: false,
      maxActiveSystems: 1,
    });
    synchronizer.setTargetSystems(['quantum']);
    expect(synchronizer.getTargetSystems()).toEqual(['quantum']);

    synchronizer.ingestQuaternion({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, { confidence: 1, timestamp: 2 });
    expect(quantum.getParameter('rot4dXW')).toBeGreaterThan(1);
    synchronizer.ingestQuaternion({ x: 0, y: 0, z: 0, w: 1 }, { confidence: 1, timestamp: 3 });

    const registrySynchronizer = new QuaternionPoseRegistrySynchronizer({
      registry,
      synchronizer,
      interpolationAlpha: 1,
      minConfidence: 0,
    });

    const frame = identityFrame({
      timestamp: 4,
      head: {
        ...BASE_HEAD,
        timestamp: 4,
        orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      },
    });

    registry.ingestFrame(frame);

    const device = registry.getDevice('headset-primary');
    expect(device?.current.orientation[1]).toBeCloseTo(Math.SQRT1_2, 5);

    const synced = registrySynchronizer.syncOnce();

    expect(synced).toBe(true);
    expect(quantum.getParameter('rot4dXW')).toBeCloseTo(Math.PI / 2, 3);

    const info = registrySynchronizer.getLastSyncInfo();
    expect(info?.deviceId).toBe('headset-primary');
    expect(info?.role).toBe('headset');
  });

  it('prefers tracked controllers when headset reliability drops', () => {
    const registry = new QuaternionPoseRegistry();
    const bridge = new MockBridge();
    const quantum = new MockSystem({ rot4dYW: 0, rot4dXW: 0, rot4dZW: 0 });

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum },
      rotationScale: 1,
      baseAlpha: 1,
      minConfidence: 0,
      energySmoothing: 1,
      velocityReference: 1,
      autoExclusiveActivation: false,
      maxActiveSystems: 1,
    });
    synchronizer.setTargetSystems(['quantum']);
    expect(synchronizer.getTargetSystems()).toEqual(['quantum']);

    const registrySynchronizer = new QuaternionPoseRegistrySynchronizer({
      registry,
      synchronizer,
      interpolationAlpha: 1,
      minConfidence: 0,
    });

    registry.ingestFrame(identityFrame());
    registrySynchronizer.syncOnce();

    registry.ingestFrame(identityFrame({
      timestamp: 16,
      head: {
        ...BASE_HEAD,
        timestamp: 16,
        reliability: 'unavailable',
      },
      controllers: [
        createController('controller-right', {
          timestamp: 16,
          orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
        }),
      ],
    }));

    const controllerDevice = registry.getDevice('controller-right');
    expect(controllerDevice?.current.orientation[1]).toBeCloseTo(Math.SQRT1_2, 5);

    const synced = registrySynchronizer.syncOnce();

    expect(synced).toBe(true);
    expect(quantum.getParameter('rot4dXW')).toBeCloseTo(Math.PI / 2, 3);

    const info = registrySynchronizer.getLastSyncInfo();
    expect(info?.deviceId).toBe('controller-right');
    expect(info?.role).toBe('controller');
  });
});

