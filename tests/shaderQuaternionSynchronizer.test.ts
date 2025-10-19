import { describe, expect, it } from 'vitest';

import { ShaderQuaternionSynchronizer } from '../src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';

class MockBridge {
  private readonly handlers = new Map<string, (event: any) => void>();

  subscribe(channel: string, callback: (event: any) => void) {
    this.handlers.set(channel, callback);
    return () => {
      this.handlers.delete(channel);
    };
  }

  emit(channel: string, event: any) {
    const handler = this.handlers.get(channel);
    handler?.(event);
  }
}

class MockSystem {
  public readonly parameters = new Map<string, number>();

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

describe('ShaderQuaternionSynchronizer', () => {
  it('routes normalized pose quaternions into shader parameters using shared math', () => {
    const bridge = new MockBridge();
    const quantum = new MockSystem({
      rot4dXY: 0,
      rot4dXZ: 0,
      rot4dYZ: 0,
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      chaos: 0.2,
      intensity: 0.7,
    });
    const holographic = new MockSystem({ hue: 320, saturation: 0.9, rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });
    const faceted = new MockSystem({ speed: 1 });

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum, holographic, faceted },
      rotationScale: 1,
      baseAlpha: 1,
      minConfidence: 0,
      energySmoothing: 1,
      velocityReference: 1,
      logger: { warn: () => {} },
      maxActiveSystems: 3
    });

    synchronizer.start();

    bridge.emit('spatial.pose', {
      payload: { orientation: { x: 0, y: 0, z: 0, w: 1 } },
      confidence: 1,
      timestamp: 0
    });

    bridge.emit('spatial.pose', {
      payload: { orientation: { x: 0, y: Math.SQRT1_2, z: 0 } },
      confidence: 1,
      timestamp: 16
    });

    expect(quantum.getParameter('rot4dXW')).toBeCloseTo(Math.PI / 2, 3);
    expect(Math.abs(quantum.getParameter('rot4dXY')) + Math.abs(quantum.getParameter('rot4dXZ')) + Math.abs(quantum.getParameter('rot4dYZ'))).toBeGreaterThan(0);
    expect(quantum.getParameter('chaos')).toBeGreaterThan(0.5);
    expect(holographic.getParameter('hue')).toBeGreaterThanOrEqual(320);
    expect(faceted.getParameter('speed')).toBeGreaterThan(1);

    synchronizer.stop();
  });

  it('limits the active target list to a single system by default', () => {
    const bridge = new MockBridge();
    const quantum = new MockSystem({ rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });
    const holographic = new MockSystem({ rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });
    const faceted = new MockSystem({ speed: 1 });

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum, holographic, faceted },
      baseAlpha: 1,
      minConfidence: 0,
      energySmoothing: 1,
      velocityReference: 1
    });

    synchronizer.start();

    bridge.emit('spatial.pose', {
      payload: { orientation: { x: 0, y: Math.SQRT1_2, z: 0 } },
      confidence: 1,
      timestamp: 4
    });

    expect(synchronizer.getTargetSystems()).toEqual(['quantum']);
    expect(quantum.getParameter('rot4dXW')).toBeGreaterThan(0);
    expect(holographic.getParameter('rot4dXW')).toBe(0);
    expect(faceted.getParameter('speed')).toBe(1);

    synchronizer.stop();
  });

  it('supports restricting updates to a specific target system', () => {
    const bridge = new MockBridge();
    const quantum = new MockSystem({ rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });
    const holographic = new MockSystem({ rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum, holographic },
      baseAlpha: 1,
      minConfidence: 0,
      energySmoothing: 1,
      velocityReference: 1,
      autoExclusiveActivation: false
    });

    synchronizer.setTargetSystems(['quantum']);
    synchronizer.start();

    bridge.emit('spatial.pose', {
      payload: { orientation: { x: 0, y: Math.SQRT1_2, z: 0 } },
      confidence: 1,
      timestamp: 8
    });

    expect(quantum.getParameter('rot4dXW')).toBeGreaterThan(0);
    expect(holographic.getParameter('rot4dXW')).toBe(0);

    synchronizer.stop();
  });

  it('reacts to system activation events to enforce exclusive targets', () => {
    const bridge = new MockBridge();
    const quantum = new MockSystem({ rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });
    const holographic = new MockSystem({ rot4dXY: 0, rot4dXZ: 0, rot4dYZ: 0, rot4dXW: 0 });

    const activationBus = new EventTarget();

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum, holographic },
      activationEventTarget: activationBus
    });

    synchronizer.start();

    const ActivationEvent = globalThis.CustomEvent || (typeof window !== 'undefined' ? window.CustomEvent : undefined);
    const createEvent = (type: string, detail: any) => {
      if (ActivationEvent) {
        return new ActivationEvent(type, { detail });
      }
      if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent(type, false, false, detail);
        return event;
      }
      throw new Error('CustomEvent is not supported in this environment');
    };

    activationBus.dispatchEvent(createEvent('vib34d:system-activated', { systemName: 'holographic' }));

    expect(synchronizer.getTargetSystems()).toEqual(['holographic']);

    activationBus.dispatchEvent(createEvent('vib34d:system-deactivated', { systemName: 'holographic' }));

    expect(synchronizer.getTargetSystems()).toEqual([]);

    synchronizer.stop();
  });
});
