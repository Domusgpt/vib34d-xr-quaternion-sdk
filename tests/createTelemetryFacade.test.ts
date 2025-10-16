import { describe, expect, it, vi } from 'vitest';
import { createTelemetryFacade } from '../src/product/telemetry/createTelemetryFacade.js';

describe('createTelemetryFacade', () => {
    it('wraps provider registration with owner chaining and instrumentation', () => {
        const harness = {
            registerProvider: vi.fn(),
            track: vi.fn(),
            registerRequestMiddleware: vi.fn(),
            clearRequestMiddleware: vi.fn()
        };
        const owner = { marker: true };
        const hooks = {
            onProviderRegistered: vi.fn()
        };

        const facade = createTelemetryFacade({ harness, owner, hooks });
        const provider = { id: 'console' };
        const chainResult = facade.registerProvider(provider);

        expect(harness.registerProvider).toHaveBeenCalledWith(provider);
        expect(hooks.onProviderRegistered).toHaveBeenCalledWith(provider, undefined);
        expect(chainResult).toBe(owner);
    });

    it('forwards commercialization helpers without altering responses', () => {
        const commercializationSnapshot = Symbol('snapshot');
        const scheduleHandle = vi.fn();
        const harness = {
            getCommercializationSummary: vi.fn().mockReturnValue({ total: 2 }),
            captureCommercializationSnapshot: vi.fn().mockReturnValue(commercializationSnapshot),
            startCommercializationSnapshotSchedule: vi.fn().mockReturnValue(scheduleHandle),
            stopCommercializationSnapshotSchedule: vi.fn()
        };

        const facade = createTelemetryFacade({ harness });
        expect(facade.getCommercializationSummary()).toEqual({ total: 2 });
        expect(facade.captureCommercializationSnapshot({ trigger: 'test' })).toBe(commercializationSnapshot);

        const scheduleResult = facade.startCommercializationSnapshotSchedule(123, { trigger: 'auto' });
        expect(harness.startCommercializationSnapshotSchedule).toHaveBeenCalledWith(123, { trigger: 'auto' });
        expect(scheduleResult).toBe(scheduleHandle);

        const stopResult = facade.stopCommercializationSnapshotSchedule();
        expect(harness.stopCommercializationSnapshotSchedule).toHaveBeenCalled();
        expect(stopResult).toBe(harness);
    });

    it('throws when invoked without a harness instance', () => {
        expect(() => createTelemetryFacade()).toThrow(/requires a ProductTelemetryHarness instance/);
    });
});
