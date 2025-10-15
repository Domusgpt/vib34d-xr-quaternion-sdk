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
    const quantum = new MockSystem({ rot4dXW: 0, rot4dYW: 0, rot4dZW: 0, chaos: 0.2, intensity: 0.7 });
    const holographic = new MockSystem({ hue: 320, saturation: 0.9 });
    const faceted = new MockSystem({ speed: 1 });

    const synchronizer = new ShaderQuaternionSynchronizer({
      bridge,
      systems: { quantum, holographic, faceted },
      rotationScale: 1,
      baseAlpha: 1,
      minConfidence: 0,
      energySmoothing: 1,
      velocityReference: 1,
      logger: { warn: () => {} }
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
    expect(quantum.getParameter('chaos')).toBeGreaterThan(0.5);
    expect(holographic.getParameter('hue')).toBeGreaterThanOrEqual(320);
    expect(faceted.getParameter('speed')).toBeGreaterThan(1);

    synchronizer.stop();
  });
});
