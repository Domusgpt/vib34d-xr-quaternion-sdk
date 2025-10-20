import { describe, it, expect, beforeEach } from 'vitest';
import { ProductTelemetryHarness } from '../src/product/ProductTelemetryHarness.js';

class TestProvider {
  id = 'test';
  events = [];
  track(event, record) {
    this.events.push({ event, record });
  }
}

describe('ProductTelemetryHarness event schemas', () => {
  let harness: ProductTelemetryHarness;
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
    harness = new ProductTelemetryHarness({
      enabled: true,
      defaultConsent: { analytics: true, interaction: true, compliance: true, system: true, biometric: false },
      providers: [provider],
      eventSchemas: [
        {
          id: 'analytics.session',
          classification: 'analytics',
          redact: ['userId']
        },
        {
          id: 'biometric.sample',
          classification: 'biometric',
          requiresConsent: true,
          validate: payload => Boolean(payload.sessionId)
        }
      ]
    });
  });

  it('applies schema redactions and updates metrics', () => {
    harness.updateConsent({ analytics: true });
    harness.track('analytics.session', { sessionId: '123', userId: 'secret' });

    expect(provider.events[0].record.payload).toEqual({ sessionId: '123' });

    const metrics = harness.getTelemetryMetrics();
    expect(metrics.events['analytics.session'].count).toBe(1);
    expect(metrics.classifications.analytics.count).toBe(1);
  });

  it('blocks events when schema validation fails', () => {
    harness.updateConsent({ biometric: true });
    harness.track('biometric.sample', { userId: 'abc' });

    expect(provider.events).toHaveLength(0);
    const audit = harness.getAuditTrail();
    expect(audit.some(entry => entry.event === 'privacy.event.schema_blocked')).toBe(true);
  });
});
