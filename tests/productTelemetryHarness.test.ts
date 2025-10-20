import { describe, it, expect, beforeEach } from 'vitest';
import { ProductTelemetryHarness } from '../src/product/ProductTelemetryHarness.js';
import { TelemetryProvider } from '../src/product/telemetry/TelemetryProvider.js';

class TestProvider extends TelemetryProvider {
  records: Array<{ event: string; record: any; context: any }>;
  audits: any[];

  constructor() {
    super({ id: 'test-provider' });
    this.records = [];
    this.audits = [];
  }

  track(event: string, record: any, context: any) {
    this.records.push({ event, record, context });
  }

  recordAudit(entry: any) {
    this.audits.push(entry);
  }
}

describe('ProductTelemetryHarness event schemas', () => {
  let harness: ProductTelemetryHarness;
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
    harness = new ProductTelemetryHarness({
      enabled: true,
      useDefaultProvider: false,
      commercialization: { enabled: false },
      defaultConsent: {
        system: true,
        compliance: true,
        interaction: true,
        analytics: true,
        biometric: false,
      },
      eventSchemas: {
        'analytics.test': {
          classification: 'analytics',
          fields: {
            total: {
              required: true,
              transform: (value: unknown) => {
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : 0;
              },
              validate: (value: unknown) => (typeof value === 'number' && value >= 0) || 'total must be a positive number',
            },
            secret: { redact: true },
            note: {
              transform: (value: unknown) => (value == null ? undefined : String(value).toUpperCase()),
              allowUndefined: true,
            },
          },
        },
      },
    });
    harness.registerProvider(provider as unknown as any);
  });

  it('sanitizes payloads via event schemas and records analytics', () => {
    harness.track('analytics.test', { total: '5', secret: 'abc', note: 'hello', ignored: 'value' });

    expect(provider.records).toHaveLength(1);
    const tracked = provider.records[0];
    expect(tracked.record.classification).toBe('analytics');
    expect(tracked.record.payload).toEqual({ total: 5, note: 'HELLO' });
    expect(tracked.record.payload).not.toHaveProperty('secret');
    expect(tracked.record.payload).not.toHaveProperty('ignored');

    const summary = harness.getAnalyticsSummary({ includeSamples: true });
    expect(summary.totalEvents).toBe(1);
    expect(summary.events[0].event).toBe('analytics.test');
    expect(summary.events[0].samplePayload).toEqual({ total: 5, note: 'HELLO' });
  });

  it('records schema validation failures as audit entries without dispatching events', () => {
    harness.track('analytics.test', { secret: 'abc' });

    expect(provider.records).toHaveLength(0);
    const auditTrail = harness.getAuditTrail();
    expect(auditTrail.some(entry => entry.event === 'privacy.schema.validation_failed')).toBe(true);
  });

  it('applies consent update schema when recording audit events', () => {
    harness.recordAudit('privacy.consent.updated', {
      applied: { analytics: true },
      metadata: { licenseKey: 'redact-me', user: 'secret-user' },
    });

    expect(provider.audits).toHaveLength(1);
    const auditEntry = provider.audits[0];
    expect(auditEntry.payload).toEqual({
      applied: { analytics: true },
      metadata: {},
      snapshot: {},
    });
    expect(harness.getAnalyticsSummary().totalEvents).toBe(1);
  });

  it('resets analytics summary', () => {
    harness.track('analytics.test', { total: 2, secret: 'hidden' });
    expect(harness.getAnalyticsSummary().totalEvents).toBe(1);

    harness.resetAnalyticsSummary();
    expect(harness.getAnalyticsSummary().totalEvents).toBe(0);
  });
});
