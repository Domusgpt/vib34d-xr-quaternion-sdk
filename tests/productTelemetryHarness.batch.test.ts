import { describe, expect, it } from 'vitest';
import { ProductTelemetryHarness } from '../src/product/ProductTelemetryHarness.js';
import { TelemetryProvider } from '../src/product/telemetry/TelemetryProvider.js';

class TestBatchProvider extends TelemetryProvider {
    constructor() {
        super({ id: 'test-batch' });
        this.tracked = [];
        this.batches = [];
    }

    track(event, payload) {
        this.tracked.push({ event, payload });
    }

    deliverBatch(records) {
        this.batches.push(records);
    }
}

describe('ProductTelemetryHarness batching', () => {
    it('delivers batches to providers when preferBatchedDelivery is enabled', async () => {
        const harness = new ProductTelemetryHarness({
            enabled: true,
            useDefaultProvider: false,
            batch: {
                maxSize: 2,
                preferBatchedDelivery: true
            },
            defaultConsent: { analytics: true }
        });
        const provider = new TestBatchProvider();
        harness.registerProvider(provider);

        harness.track('test.event.one', { value: 1 });
        harness.track('test.event.two', { value: 2 });

        await harness.flushBatches({ reason: 'test' });

        expect(provider.tracked).toHaveLength(0);
        expect(provider.batches).toHaveLength(1);
        expect(provider.batches[0]).toHaveLength(2);
    });

    it('falls back to immediate tracking when provider lacks deliverBatch', async () => {
        const harness = new ProductTelemetryHarness({
            enabled: true,
            useDefaultProvider: false,
            batch: {
                preferBatchedDelivery: true
            },
            defaultConsent: { analytics: true }
        });

        class ImmediateProvider extends TelemetryProvider {
            constructor() {
                super({ id: 'immediate' });
                this.tracked = [];
            }

            track(event, payload) {
                this.tracked.push({ event, payload });
            }
        }

        const provider = new ImmediateProvider();
        harness.registerProvider(provider);

        harness.track('test.event.three', { value: 3 });
        await harness.flushBatches({ reason: 'test-immediate' });

        expect(provider.tracked).toHaveLength(1);
        expect(provider.tracked[0].event).toBe('test.event.three');
    });

    it('exposes batcher metrics for external observers', () => {
        const harness = new ProductTelemetryHarness({
            enabled: true,
            useDefaultProvider: false,
            batch: {
                maxSize: 5,
                maxBufferedEvents: 10
            },
            defaultConsent: { analytics: true }
        });
        const batcher = harness.getTelemetryBatcher();
        expect(batcher).toBeTruthy();
        expect(batcher.getMetrics()).toMatchObject({ dropped: 0, delivered: 0 });
    });
});
