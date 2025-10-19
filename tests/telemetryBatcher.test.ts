import { describe, expect, it, vi, afterEach } from 'vitest';
import { TelemetryBatcher } from '../src/product/telemetry/TelemetryBatcher.js';

function waitForMicrotask() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('TelemetryBatcher', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes when max batch size is reached', async () => {
        const onFlush = vi.fn();
        const batcher = new TelemetryBatcher({ maxBatchSize: 2, onFlush });

        batcher.enqueue({ event: 'a' });
        batcher.enqueue({ event: 'b' });

        await waitForMicrotask();

        expect(onFlush).toHaveBeenCalledTimes(1);
        expect(onFlush.mock.calls[0][0]).toHaveLength(2);
        expect(onFlush.mock.calls[0][1]).toMatchObject({ reason: 'max-size' });
    });

    it('flushes after exceeding max batch age', async () => {
        vi.useFakeTimers();
        const onFlush = vi.fn();
        const batcher = new TelemetryBatcher({ maxBatchAgeMs: 50, onFlush });

        batcher.enqueue({ event: 'age-test' });

        await vi.advanceTimersByTimeAsync(60);

        expect(onFlush).toHaveBeenCalledTimes(1);
        expect(onFlush.mock.calls[0][0]).toHaveLength(1);
        expect(onFlush.mock.calls[0][1]).toMatchObject({ reason: 'max-age' });
    });

    it('retries delivery when flush fails and retryOnFailure is enabled', async () => {
        const onFlush = vi
            .fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValueOnce(undefined);
        const batcher = new TelemetryBatcher({ maxBatchSize: 2, onFlush, retryOnFailure: true, maxBatchAgeMs: 10 });

        batcher.enqueue({ event: 'retry-test' });
        await batcher.flush({ reason: 'manual' });
        await batcher.flush({ reason: 'retry' });

        expect(onFlush).toHaveBeenCalledTimes(2);
        expect(batcher.getMetrics().dropped).toBe(0);
    });
});
