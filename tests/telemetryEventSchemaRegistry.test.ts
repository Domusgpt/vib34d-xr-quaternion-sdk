import { describe, it, expect } from 'vitest';
import { TelemetryEventSchemaRegistry } from '../src/product/telemetry/TelemetryEventSchemaRegistry.js';

describe('TelemetryEventSchemaRegistry', () => {
  it('matches exact ids before prefixes', () => {
    const registry = new TelemetryEventSchemaRegistry({ defaultClassification: 'analytics' });
    registry.register({ prefix: 'design.', classification: 'analytics' });
    registry.register({ id: 'design.layout.updated', classification: 'interaction' });

    const result = registry.evaluate('design.layout.updated', { userId: 'abc' });
    expect(result.classification).toBe('interaction');
  });

  it('redacts and masks payload fields', () => {
    const registry = new TelemetryEventSchemaRegistry();
    registry.register({
      id: 'biometric.stress',
      classification: 'biometric',
      redact: ['userId'],
      mask: {
        sample: (value: { raw: number }) => ({ raw: Math.round(value.raw * 10) / 10 })
      }
    });

    const result = registry.evaluate('biometric.stress', {
      userId: 'secret',
      sample: { raw: 0.12345 }
    });

    expect(result.payload).toEqual({ sample: { raw: 0.1 } });
    expect(result.requiresConsent).toBe(true);
  });

  it('blocks payloads that fail validation', () => {
    const registry = new TelemetryEventSchemaRegistry();
    registry.register({
      id: 'analytics.session',
      classification: 'analytics',
      validate: payload => {
        if (typeof payload.sessionId !== 'string') {
          return { allowed: false, reason: 'missing-session' };
        }
        return true;
      }
    });

    const result = registry.evaluate('analytics.session', {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('missing-session');
  });
});
