import type {
    JsonObject,
    TelemetryBatchContext,
    TelemetryBatchFlushOptions,
    TelemetryBatchFlushResult,
    TelemetryBatchMetrics,
    TelemetryBatchOptions,
    TelemetryEvent
} from '../../adaptive-sdk';

type TelemetryBatcherFlushHandler = (
    records: TelemetryEvent[],
    context: TelemetryBatchContext
) => unknown | Promise<unknown>;

export declare interface TelemetryBatcherConstructorOptions extends TelemetryBatchOptions {
    maxBatchSize?: number;
    maxBatchAgeMs?: number;
    maxBufferedEvents?: number;
    retryOnFailure?: boolean;
    logger?: Console;
    onFlush?: TelemetryBatcherFlushHandler;
}

export declare class TelemetryBatcher {
    constructor(options?: TelemetryBatcherConstructorOptions);
    readonly size: number;
    readonly oldestTimestamp: number | null;
    enqueue(record: TelemetryEvent, context?: JsonObject): void;
    flush(options?: TelemetryBatchFlushOptions): Promise<TelemetryBatchFlushResult>;
    drain(options?: TelemetryBatchFlushOptions): Promise<TelemetryBatchFlushResult>;
    getMetrics(): TelemetryBatchMetrics;
    start(): void;
    stop(): void;
}
