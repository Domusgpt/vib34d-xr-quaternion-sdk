import { TelemetryProvider } from './TelemetryProvider.js';

export class PartnerTelemetryProvider extends TelemetryProvider {
    constructor(options = {}) {
        super({ id: options.id || 'partner', metadata: { storage: 'external', partner: options.partner || 'unspecified', ...options.metadata } });
        this.forward = options.forward ?? (() => Promise.resolve());
    }

    identify(identity, traits = {}) {
        return this.forward({ type: 'identify', identity, traits, timestamp: Date.now() });
    }

    track(event, payload) {
        return this.forward({ type: 'track', event, payload, timestamp: Date.now() });
    }

    flush() {
        return this.forward({ type: 'flush', timestamp: Date.now() });
    }
}
