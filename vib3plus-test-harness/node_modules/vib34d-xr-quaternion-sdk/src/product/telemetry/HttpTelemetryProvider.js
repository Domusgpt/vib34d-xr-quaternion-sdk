import { TelemetryProvider } from './TelemetryProvider.js';

export class HttpTelemetryProvider extends TelemetryProvider {
    constructor(options = {}) {
        super({ id: 'http', metadata: { storage: 'remote', ...options.metadata } });
        this.endpoint = options.endpoint;
        this.headers = options.headers || { 'Content-Type': 'application/json' };
        this.queue = [];

        this.requestMiddleware = [];
        if (Array.isArray(options.requestMiddleware)) {
            for (const middleware of options.requestMiddleware) {
                this.registerRequestMiddleware(middleware);
            }
        }
    }

    identify(identity, traits = {}) {
        this.queue.push({ type: 'identify', identity, traits, timestamp: Date.now() });
    }

    track(event, payload) {
        this.queue.push({ type: 'track', event, payload, timestamp: Date.now() });
    }

    async flush() {
        if (!this.endpoint || this.queue.length === 0) {
            this.queue = [];
            return;
        }

        const payload = { events: this.queue };
        this.queue = [];
        try {
            const request = await this.applyRequestMiddleware({
                endpoint: this.endpoint,
                options: {
                    method: 'POST',
                    headers: { ...this.headers },
                    body: JSON.stringify(payload)
                },
                events: payload.events
            });

            await fetch(request.endpoint, request.options);
        } catch (error) {
            console.warn('[HttpTelemetryProvider] Failed to deliver telemetry', error);
        }
    }

    registerRequestMiddleware(middleware) {
        if (typeof middleware === 'function') {
            this.requestMiddleware.push(middleware);
        }
    }

    clearRequestMiddleware() {
        this.requestMiddleware = [];
    }

    async applyRequestMiddleware(initialContext) {
        if (!this.requestMiddleware.length) {
            return initialContext;
        }

        let context = {
            endpoint: initialContext.endpoint,
            options: {
                ...(initialContext.options || {}),
                headers: {
                    ...(initialContext.options?.headers || {})
                }
            },
            events: initialContext.events,
            provider: this
        };

        for (const middleware of this.requestMiddleware) {
            if (typeof middleware !== 'function') continue;
            try {
                const result = await middleware({ ...context });
                if (!result || typeof result !== 'object') {
                    continue;
                }

                if (result.endpoint) {
                    context.endpoint = result.endpoint;
                }

                if (result.options) {
                    const nextOptions = { ...context.options, ...result.options };
                    nextOptions.headers = {
                        ...(context.options.headers || {}),
                        ...(result.options.headers || {})
                    };
                    context.options = nextOptions;
                }

                if (result.metadata) {
                    context.metadata = { ...(context.metadata || {}), ...result.metadata };
                }
            } catch (error) {
                console.warn('[HttpTelemetryProvider] Request middleware error', error);
            }
        }

        return context;
    }
}
