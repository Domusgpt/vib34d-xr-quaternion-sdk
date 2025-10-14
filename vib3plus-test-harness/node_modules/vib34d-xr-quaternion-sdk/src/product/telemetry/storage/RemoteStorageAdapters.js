const DEFAULT_CONTENT_TYPE = 'application/json';
const DEFAULT_ENCRYPTED_CONTENT_TYPE = 'application/octet-stream';

function resolveFetch(customFetch) {
    if (customFetch) {
        return customFetch;
    }
    if (typeof fetch === 'function') {
        return fetch.bind(globalThis);
    }
    throw new Error('[RemoteStorageAdapters] No fetch implementation available. Provide one via `fetchImplementation`.');
}

function defaultSerializeRecords(records, context = {}) {
    return {
        exportedAt: new Date().toISOString(),
        recordCount: Array.isArray(records) ? records.length : 0,
        ...(context.retentionPolicy ? { retentionPolicy: context.retentionPolicy } : {}),
        records
    };
}

function normalizeRetentionPolicy(retentionPolicy) {
    if (!retentionPolicy) {
        return undefined;
    }

    if (typeof retentionPolicy === 'string') {
        return { strategy: retentionPolicy };
    }

    if (typeof retentionPolicy === 'number') {
        return { strategy: 'timeboxed', maxAgeMs: retentionPolicy };
    }

    if (typeof retentionPolicy === 'object') {
        const {
            strategy = 'custom',
            maxAgeMs,
            legalHold,
            deleteAfterUpload,
            metadata
        } = retentionPolicy;

        const normalized = { strategy };

        if (typeof maxAgeMs === 'number' && Number.isFinite(maxAgeMs)) {
            normalized.maxAgeMs = maxAgeMs;
        }

        if (typeof legalHold === 'boolean') {
            normalized.legalHold = legalHold;
        }

        if (typeof deleteAfterUpload === 'boolean') {
            normalized.deleteAfterUpload = deleteAfterUpload;
        }

        if (metadata && typeof metadata === 'object') {
            normalized.metadata = metadata;
        }

        return normalized;
    }

    return undefined;
}

function isBinaryLike(value) {
    const isBlobAvailable = typeof Blob !== 'undefined';
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || (isBlobAvailable && value instanceof Blob);
}

async function buildPayload(records, {
    serialize,
    encryptPayload,
    encryptionContentType = DEFAULT_ENCRYPTED_CONTENT_TYPE,
    adapterId,
    retentionPolicy
}) {
    const serialized = typeof serialize === 'function'
        ? serialize(records, { retentionPolicy })
        : defaultSerializeRecords(records, { retentionPolicy });

    let body = serialized;
    if (!isBinaryLike(body) && typeof body !== 'string') {
        body = JSON.stringify(body);
    }

    let contentType = DEFAULT_CONTENT_TYPE;
    let headers = {};
    let metadata = {};

    if (typeof encryptPayload === 'function') {
        const encryptionResult = await encryptPayload(body, {
            adapter: adapterId,
            records,
            retentionPolicy
        });

        if (typeof encryptionResult === 'string' || isBinaryLike(encryptionResult)) {
            body = encryptionResult;
            contentType = encryptionContentType || contentType;
        } else if (encryptionResult && typeof encryptionResult === 'object') {
            if (encryptionResult.body !== undefined) {
                const nextBody = encryptionResult.body;
                body = typeof nextBody === 'string' || isBinaryLike(nextBody) ? nextBody : JSON.stringify(nextBody);
            }

            if (encryptionResult.contentType) {
                contentType = encryptionResult.contentType;
            } else if (encryptionResult.useDefaultContentType === false && !encryptionResult.contentType) {
                contentType = encryptionContentType || contentType;
            }

            if (encryptionResult.headers && typeof encryptionResult.headers === 'object') {
                headers = { ...headers, ...encryptionResult.headers };
            }

            if (encryptionResult.metadata && typeof encryptionResult.metadata === 'object') {
                metadata = { ...metadata, ...encryptionResult.metadata };
            }
        }
    }

    return {
        body,
        contentType,
        headers,
        metadata
    };
}

export function createSignedS3StorageAdapter(options = {}) {
    const {
        signingEndpoint,
        signingMethod = 'POST',
        signingHeaders,
        signingPayload,
        uploadMethod = 'PUT',
        fetchImplementation,
        uploadHeaders,
        serialize,
        onUploadComplete,
        onError,
        deleteEndpoint,
        deleteMethod = 'DELETE',
        retentionPolicy,
        encryptPayload,
        encryptionContentType = DEFAULT_ENCRYPTED_CONTENT_TYPE
    } = options;

    const fetchFn = resolveFetch(fetchImplementation);

    async function obtainUploadTarget(payloadMetadata = {}) {
        if (!signingEndpoint) {
            throw new Error('[createSignedS3StorageAdapter] `signingEndpoint` is required.');
        }

        const response = await fetchFn(signingEndpoint, {
            method: signingMethod,
            headers: {
                'content-type': DEFAULT_CONTENT_TYPE,
                ...signingHeaders
            },
            body: JSON.stringify({
                operation: 'PUT_OBJECT',
                ...signingPayload,
                ...payloadMetadata
            })
        });

        if (!response.ok) {
            const error = new Error(`[createSignedS3StorageAdapter] Failed to obtain signed URL (${response.status})`);
            onError?.(error);
            throw error;
        }

        const data = await response.json();
        if (!data?.uploadUrl) {
            const error = new Error('[createSignedS3StorageAdapter] Signing endpoint did not return `uploadUrl`.');
            onError?.(error);
            throw error;
        }

        return data;
    }

    return {
        async write(records) {
            try {
                if (!Array.isArray(records) || records.length === 0) {
                    return;
                }

                const normalizedRetention = normalizeRetentionPolicy(retentionPolicy);
                const { body, contentType, headers: encryptionHeaders, metadata } = await buildPayload(records, {
                    serialize,
                    encryptPayload,
                    encryptionContentType,
                    adapterId: 'signed-s3',
                    retentionPolicy: normalizedRetention
                });

                const target = await obtainUploadTarget({
                    recordCount: records.length,
                    retentionPolicy: normalizedRetention,
                    encryption: Object.keys(metadata).length ? metadata : undefined
                });

                const uploadHeadersPayload = {
                    'content-type': contentType,
                    ...target.headers,
                    ...uploadHeaders,
                    ...encryptionHeaders
                };

                if (normalizedRetention) {
                    uploadHeadersPayload['x-amz-meta-retention'] = JSON.stringify(normalizedRetention);
                }

                if (Object.keys(metadata).length) {
                    uploadHeadersPayload['x-amz-meta-encryption'] = JSON.stringify(metadata);
                }

                const response = await fetchFn(target.uploadUrl, {
                    method: uploadMethod,
                    headers: uploadHeadersPayload,
                    body
                });

                if (!response.ok) {
                    const error = new Error(`[createSignedS3StorageAdapter] Upload failed (${response.status})`);
                    onError?.(error);
                    throw error;
                }

                onUploadComplete?.({
                    key: target.key,
                    location: target.uploadUrl,
                    recordCount: records.length,
                    retentionPolicy: normalizedRetention,
                    encryptionMetadata: metadata
                });
            } catch (error) {
                onError?.(error);
                throw error;
            }
        },
        async clear() {
            if (!deleteEndpoint) {
                return;
            }

            const response = await fetchFn(deleteEndpoint, {
                method: deleteMethod,
                headers: signingHeaders
            });

            if (!response.ok) {
                const error = new Error(`[createSignedS3StorageAdapter] Failed to clear remote vault (${response.status})`);
                onError?.(error);
                throw error;
            }
        },
        async read() {
            return [];
        }
    };
}

export function createLogBrokerStorageAdapter(options = {}) {
    const {
        endpoint,
        method = 'POST',
        headers,
        fetchImplementation,
        serialize,
        onError,
        retentionPolicy,
        encryptPayload,
        encryptionContentType = DEFAULT_ENCRYPTED_CONTENT_TYPE
    } = options;

    if (!endpoint) {
        throw new Error('[createLogBrokerStorageAdapter] `endpoint` is required.');
    }

    const fetchFn = resolveFetch(fetchImplementation);

    return {
        async write(records) {
            try {
                if (!Array.isArray(records) || records.length === 0) {
                    return;
                }

                const normalizedRetention = normalizeRetentionPolicy(retentionPolicy);
                const { body, contentType, headers: encryptionHeaders, metadata } = await buildPayload(records, {
                    serialize,
                    encryptPayload,
                    encryptionContentType,
                    adapterId: 'log-broker',
                    retentionPolicy: normalizedRetention
                });

                const requestHeaders = {
                    'content-type': contentType,
                    ...headers,
                    ...encryptionHeaders
                };

                if (normalizedRetention) {
                    requestHeaders['x-retention-policy'] = JSON.stringify(normalizedRetention);
                }

                if (Object.keys(metadata).length) {
                    requestHeaders['x-encryption-metadata'] = JSON.stringify(metadata);
                }

                const response = await fetchFn(endpoint, {
                    method,
                    headers: requestHeaders,
                    body
                });

                if (!response.ok) {
                    const error = new Error(`[createLogBrokerStorageAdapter] Failed to deliver compliance batch (${response.status})`);
                    onError?.(error);
                    throw error;
                }
            } catch (error) {
                onError?.(error);
                throw error;
            }
        },
        async clear() {
            // Log brokers typically treat new uploads as append-only; clearing is a no-op.
        },
        async read() {
            return [];
        }
    };
}
