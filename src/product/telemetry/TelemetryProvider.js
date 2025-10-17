export class TelemetryProvider {
    constructor({ id, metadata = {} } = {}) {
        if (!id) {
            throw new Error('TelemetryProvider requires an `id`.');
        }
        this.id = id;
        this.metadata = metadata;
    }

    identify() {}

    track() {}

    deliverBatch() {}

    flush() {}

    recordAudit() {}
}
