import { describe, expect, it, vi } from 'vitest';
import { ProductTelemetryHarness } from '../src/product/ProductTelemetryHarness.js';
import {
    createReferenceTelemetryBlueprints,
    registerReferenceTelemetryProviders
} from '../src/product/telemetry/providers/referenceTelemetryProviders.js';

describe('reference telemetry providers', () => {
    it('registers reference providers and exports a consent bundle', () => {
        const harness = new ProductTelemetryHarness({ useDefaultProvider: false });

        const result = registerReferenceTelemetryProviders(harness, {
            consentBundle: { revision: 2, metadata: { exportedBy: 'test-suite' } },
            http: { endpoint: 'https://example.test/collect' }
        });

        expect(result.providers.console.blueprint.id).toBe('console');
        expect(result.providers.http.provider.endpoint).toBe('https://example.test/collect');
        expect(result.blueprints.complianceVault.retentionDays).toBeGreaterThan(100);
        expect(result.consentBundle?.envelope?.metadata?.exportedBy).toBe('test-suite');
        expect(harness.providers.size).toBe(3);
    });

    it('respects blueprint overrides and disable flags when generating catalogs', () => {
        const catalog = createReferenceTelemetryBlueprints({
            http: {
                blueprint: {
                    retentionDays: 7,
                    events: ['custom.event']
                }
            },
            complianceVault: { enabled: false }
        });

        expect(catalog.http.retentionDays).toBe(7);
        expect(catalog.http.events[0].name).toBe('custom.event');
        expect(catalog.complianceVault).toBeUndefined();
    });

    it('allows overriding providers and skipping consent exports', () => {
        const harness = new ProductTelemetryHarness({ useDefaultProvider: false });
        const customConsole = { id: 'console', track: vi.fn(), flush: vi.fn() };

        const result = registerReferenceTelemetryProviders(harness, {
            console: { provider: customConsole },
            consentBundle: false
        });

        expect(result.consentBundle).toBeNull();
        expect(harness.providers.get('console')).toBe(customConsole);
        expect(result.providers.console.provider).toBe(customConsole);
    });
});
