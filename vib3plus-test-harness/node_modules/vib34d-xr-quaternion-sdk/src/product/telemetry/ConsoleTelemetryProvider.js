import { TelemetryProvider } from './TelemetryProvider.js';

export class ConsoleTelemetryProvider extends TelemetryProvider {
    constructor(options = {}) {
        super({ id: 'console', metadata: { storage: 'memory', ...options.metadata } });
        this.events = [];
        this.identities = [];
        this.log = options.log ?? false;
    }

    identify(identity, traits = {}) {
        const record = { identity, traits, timestamp: Date.now() };
        this.identities.push(record);
        if (this.log) {
            console.info('[ConsoleTelemetryProvider] identify', record);
        }
    }

    track(event, payload) {
        const record = { event, payload, timestamp: Date.now() };
        this.events.push(record);
        if (this.log) {
            console.info('[ConsoleTelemetryProvider] track', record);
        }
    }

    flush() {
        if (this.log && this.events.length) {
            console.table(this.events);
        }
        this.events = [];
    }
}
