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

    deliverBatch(records = [], context = {}) {
        if (!Array.isArray(records) || records.length === 0) {
            return;
        }

        for (const record of records) {
            const entry = {
                event: record.event,
                payload: record,
                timestamp: Date.now(),
                context
            };
            this.events.push(entry);
            if (this.log) {
                console.info('[ConsoleTelemetryProvider] batch', entry);
            }
        }
    }

    flush() {
        if (this.log && this.events.length) {
            console.table(this.events);
        }
        this.events = [];
    }
}
