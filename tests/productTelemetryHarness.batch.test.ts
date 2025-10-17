import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function createMockEventTarget() {
    const listeners = new Map();
    const target = {
        addEventListener: vi.fn((type, handler) => {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(handler);
        }),
        removeEventListener: vi.fn((type, handler) => {
            listeners.get(type)?.delete(handler);
        }),
        dispatchEvent: (type, event) => {
            const handlers = listeners.get(type);
            if (!handlers) {
                return;
            }
            for (const handler of handlers) {
                handler(event);
            }
        }
    };
    return { target, listeners };
}

let originalWindow;
let originalDocument;

beforeEach(() => {
    originalWindow = global.window;
    originalDocument = global.document;
});

afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    vi.restoreAllMocks();
});

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

describe('ProductTelemetryHarness auto flush triggers', () => {
    it('flushes batches on visibility and lifecycle events', async () => {
        const mockWindow = createMockEventTarget();
        const mockDocument = createMockEventTarget();
        mockDocument.target.visibilityState = 'visible';

        global.window = mockWindow.target;
        global.document = mockDocument.target;

        const harness = new ProductTelemetryHarness({
            enabled: true,
            useDefaultProvider: false,
            batch: {
                enabled: true,
                autoFlush: {
                    visibilityChange: true,
                    pageHide: true,
                    beforeUnload: true,
                    flushHiddenOnly: true
                }
            },
            defaultConsent: { analytics: true }
        });

        const flushSpy = vi.spyOn(harness, 'flushBatches').mockResolvedValue({
            batches: 0,
            events: 0,
            delivered: 0,
            dropped: 0,
            reason: 'stub'
        });

        harness.start();

        mockDocument.target.visibilityState = 'hidden';
        mockDocument.target.dispatchEvent('visibilitychange', {});
        await Promise.resolve();
        expect(flushSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'visibility-change' }));

        mockWindow.target.dispatchEvent('pagehide', {});
        await Promise.resolve();
        expect(flushSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'page-hide' }));

        mockWindow.target.dispatchEvent('beforeunload', {});
        await Promise.resolve();
        expect(flushSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'before-unload' }));

        harness.stop();

        expect(mockWindow.target.removeEventListener).toHaveBeenCalled();
        expect(mockDocument.target.removeEventListener).toHaveBeenCalled();
    });

    it('supports custom auto flush registrations', async () => {
        let customFlush;
        let cleanupCalled = false;
        const customRegistration = vi.fn((flush) => {
            customFlush = flush;
            return () => {
                cleanupCalled = true;
            };
        });

        const harness = new ProductTelemetryHarness({
            enabled: true,
            useDefaultProvider: false,
            batch: {
                enabled: true,
                autoFlush: {
                    visibilityChange: false,
                    pageHide: false,
                    beforeUnload: false,
                    custom: [customRegistration]
                }
            },
            defaultConsent: { analytics: true }
        });

        const flushSpy = vi.spyOn(harness, 'flushBatches').mockResolvedValue({
            batches: 0,
            events: 0,
            delivered: 0,
            dropped: 0,
            reason: 'stub'
        });

        harness.start();
        expect(customRegistration).toHaveBeenCalledTimes(1);
        expect(typeof customFlush).toBe('function');

        await customFlush?.('custom-trigger');
        expect(flushSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'custom-trigger' }));

        harness.stop();
        expect(cleanupCalled).toBe(true);
    });

    it('does not register listeners when auto flush is disabled', () => {
        const mockWindow = createMockEventTarget();
        const mockDocument = createMockEventTarget();

        global.window = mockWindow.target;
        global.document = mockDocument.target;

        const harness = new ProductTelemetryHarness({
            enabled: true,
            useDefaultProvider: false,
            batch: {
                enabled: true,
                autoFlush: false
            },
            defaultConsent: { analytics: true }
        });

        harness.start();

        expect(mockWindow.target.addEventListener).not.toHaveBeenCalled();
        expect(mockDocument.target.addEventListener).not.toHaveBeenCalled();

        harness.stop();
    });
});
