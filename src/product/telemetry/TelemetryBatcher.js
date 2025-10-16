export class TelemetryBatcher {
    constructor(options = {}) {
        this.maxBatchSize = Number.isFinite(options.maxBatchSize) && options.maxBatchSize > 0
            ? Math.floor(options.maxBatchSize)
            : 50;
        this.maxBatchAgeMs = Number.isFinite(options.maxBatchAgeMs) && options.maxBatchAgeMs > 0
            ? options.maxBatchAgeMs
            : 15000;
        this.maxBufferedEvents = Number.isFinite(options.maxBufferedEvents) && options.maxBufferedEvents > 0
            ? Math.floor(options.maxBufferedEvents)
            : 1000;
        this.retryOnFailure = options.retryOnFailure !== false;
        this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
        this.logger = options.logger || null;
        this.onFlush = typeof options.onFlush === 'function' ? options.onFlush : null;
        this.scheduler = options.scheduler || {
            setTimeout: (handler, delay) => setTimeout(handler, delay),
            clearTimeout: (handle) => clearTimeout(handle)
        };

        this.buffer = [];
        this.flushHandle = null;
        this.metrics = {
            dropped: 0,
            delivered: 0,
            flushes: 0
        };
        this.sequence = 0;
    }

    get size() {
        return this.buffer.length;
    }

    get oldestTimestamp() {
        return this.buffer.length ? this.buffer[0].receivedAt : null;
    }

    getMetrics() {
        return {
            dropped: this.metrics.dropped,
            delivered: this.metrics.delivered,
            flushes: this.metrics.flushes,
            bufferSize: this.buffer.length
        };
    }

    enqueue(record, context = {}) {
        if (!record) {
            return;
        }

        const entry = {
            record,
            receivedAt: this.clock(),
            context
        };

        if (this.buffer.length >= this.maxBufferedEvents) {
            const dropped = this.buffer.shift();
            this.metrics.dropped += 1;
            if (this.logger?.warn) {
                this.logger.warn('[TelemetryBatcher] Dropping telemetry entry due to capacity limit', {
                    dropped,
                    maxBufferedEvents: this.maxBufferedEvents
                });
            }
        }

        this.buffer.push(entry);

        if (this.buffer.length >= this.maxBatchSize) {
            this.flush({ reason: 'max-size' }).catch((error) => {
                this.logger?.error?.('[TelemetryBatcher] Failed to flush on max-size trigger', error);
            });
            return;
        }

        this.scheduleFlush();
    }

    scheduleFlush() {
        if (!Number.isFinite(this.maxBatchAgeMs) || this.maxBatchAgeMs <= 0) {
            return;
        }
        if (!this.buffer.length) {
            this.clearScheduledFlush();
            return;
        }
        const oldest = this.buffer[0].receivedAt;
        const age = this.clock() - oldest;
        const remaining = Math.max(0, this.maxBatchAgeMs - age);
        if (this.flushHandle && remaining > 0) {
            return;
        }
        this.clearScheduledFlush();
        this.flushHandle = this.scheduler.setTimeout(() => {
            this.flush({ reason: 'max-age' }).catch((error) => {
                this.logger?.error?.('[TelemetryBatcher] Failed to flush on max-age trigger', error);
            });
        }, remaining || 0);
    }

    clearScheduledFlush() {
        if (this.flushHandle) {
            this.scheduler.clearTimeout(this.flushHandle);
            this.flushHandle = null;
        }
    }

    async flush(options = {}) {
        if (!this.buffer.length) {
            this.clearScheduledFlush();
            return {
                batches: 0,
                events: 0,
                reason: options.reason || 'manual',
                delivered: 0,
                dropped: this.metrics.dropped
            };
        }

        const pending = this.buffer;
        this.buffer = [];
        this.clearScheduledFlush();

        const reason = options.reason || 'manual';
        const earliest = pending[0]?.receivedAt || this.clock();
        const startedAt = this.clock();
        const batches = [];

        for (let index = 0; index < pending.length; index += this.maxBatchSize) {
            batches.push(pending.slice(index, index + this.maxBatchSize));
        }

        let delivered = 0;
        this.metrics.flushes += 1;

        for (const chunk of batches) {
            const payload = chunk.map(entry => entry.record);
            if (!this.onFlush) {
                delivered += payload.length;
                this.metrics.delivered += payload.length;
                continue;
            }

            try {
                await this.onFlush(payload, {
                    reason,
                    sequence: ++this.sequence,
                    startedAt,
                    triggeredAt: earliest,
                    windowMs: Math.max(0, startedAt - earliest),
                    size: payload.length
                });
                delivered += payload.length;
                this.metrics.delivered += payload.length;
            } catch (error) {
                if (this.logger?.error) {
                    this.logger.error('[TelemetryBatcher] Failed to deliver telemetry batch', error);
                }
                if (this.retryOnFailure) {
                    this.buffer.unshift(...chunk);
                    this.scheduleFlush();
                }
            }
        }

        return {
            batches: batches.length,
            events: pending.length,
            delivered,
            dropped: this.metrics.dropped,
            reason
        };
    }

    async drain(options = {}) {
        return this.flush({ ...options, reason: options.reason || 'drain' });
    }

    start() {
        this.scheduleFlush();
    }

    stop() {
        this.clearScheduledFlush();
    }
}
