const DEFAULT_SIGNATURE_HEADER = 'x-adaptive-signature';
const DEFAULT_ALGORITHM_HEADER = 'x-adaptive-signature-algorithm';
const DEFAULT_TIMESTAMP_HEADER = 'x-adaptive-signature-timestamp';

function serializeBody(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(body).toString('base64');
        }
        return '[binary]';
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return '[blob]';
    }
    try {
        return JSON.stringify(body);
    } catch (error) {
        return String(body);
    }
}

export function createRequestSigningMiddleware(options = {}) {
    const {
        signer,
        header = DEFAULT_SIGNATURE_HEADER,
        algorithmHeader = DEFAULT_ALGORITHM_HEADER,
        timestampHeader = DEFAULT_TIMESTAMP_HEADER,
        includeEventDigest = true,
        digestSeparator = ':',
        metadataKey = 'signature'
    } = options;

    if (typeof signer !== 'function') {
        throw new Error('[createRequestSigningMiddleware] `signer` function is required.');
    }

    return async function requestSigningMiddleware(context) {
        const { endpoint, options: requestOptions = {}, events = [] } = context;
        const method = (requestOptions.method || 'POST').toUpperCase();
        const timestamp = new Date().toISOString();
        const bodyForSigning = serializeBody(requestOptions.body);

        const digestParts = [method, endpoint, timestamp];
        if (includeEventDigest) {
            digestParts.push(String(events.length));
        }
        const signingInput = {
            endpoint,
            method,
            timestamp,
            events,
            body: bodyForSigning,
            digest: digestParts.join(digestSeparator),
            metadata: context.metadata || {}
        };

        const signatureResult = await signer(signingInput);
        if (!signatureResult) {
            return {
                options: {
                    headers: timestampHeader ? { [timestampHeader]: timestamp } : {}
                },
                metadata: { [metadataKey]: { issuedAt: timestamp } }
            };
        }

        const headers = {};
        const metadata = { [metadataKey]: { issuedAt: timestamp } };
        let nextOptions = {};
        let nextEndpoint;

        if (typeof signatureResult === 'string') {
            headers[header] = signatureResult;
        } else if (typeof signatureResult === 'object') {
            if (signatureResult.signature) {
                headers[header] = signatureResult.signature;
            }

            if (signatureResult.headers && typeof signatureResult.headers === 'object') {
                Object.assign(headers, signatureResult.headers);
            }

            if (signatureResult.algorithm) {
                metadata[metadataKey].algorithm = signatureResult.algorithm;
            }

            if (signatureResult.metadata && typeof signatureResult.metadata === 'object') {
                metadata[metadataKey] = { ...metadata[metadataKey], ...signatureResult.metadata };
            }

            if (signatureResult.options && typeof signatureResult.options === 'object') {
                nextOptions = signatureResult.options;
            }

            if (signatureResult.endpoint) {
                nextEndpoint = signatureResult.endpoint;
            }

            if (signatureResult.timestamp) {
                metadata[metadataKey].issuedAt = signatureResult.timestamp;
            }
        }

        if (algorithmHeader && !metadata[metadataKey].algorithm && options.algorithm) {
            metadata[metadataKey].algorithm = options.algorithm;
        }

        if (timestampHeader) {
            headers[timestampHeader] = metadata[metadataKey].issuedAt || timestamp;
        }

        if (algorithmHeader && metadata[metadataKey].algorithm) {
            headers[algorithmHeader] = metadata[metadataKey].algorithm;
        }

        return {
            endpoint: nextEndpoint,
            options: {
                headers,
                ...nextOptions
            },
            metadata
        };
    };
}
