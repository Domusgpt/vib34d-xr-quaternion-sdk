# Remote Storage Encryption Templates

## Purpose
Partner teams integrating the compliance vault into regulated environments need concrete examples of how to encrypt audit exports before they leave the device or trusted network. This playbook expands on the hooks described in the Telemetry Privacy & Consent Guide by providing reusable templates for customer-managed keys, envelope encryption, and metadata propagation.

## Template 1 – AWS KMS + AES-GCM Wrapper
```js
import { subtle } from 'crypto'.webcrypto;

export async function createKmsAesGcmEncryptor({ kmsClient, keyId }) {
  if (!kmsClient || !keyId) {
    throw new Error('[createKmsAesGcmEncryptor] `kmsClient` and `keyId` are required.');
  }

  return async function encryptPayload(payload, { adapter, retentionPolicy }) {
    const plaintext = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;

    // 1. Ask KMS for a data key (returns plaintext + ciphertext versions).
    const { Plaintext: dataKey, CiphertextBlob: encryptedKey } = await kmsClient.generateDataKey({
      KeyId: keyId,
      KeySpec: 'AES_256'
    });

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt']);
    const cipherBuffer = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    return {
      body: cipherBuffer,
      contentType: 'application/octet-stream',
      headers: {
        'x-adaptive-encryption': 'kms-aes-gcm',
        'x-adaptive-encryption-key': Buffer.from(encryptedKey).toString('base64'),
        'x-adaptive-encryption-iv': Buffer.from(iv).toString('base64')
      },
      metadata: {
        kmsKeyId: keyId,
        adapter,
        retentionPolicy
      }
    };
  };
}
```

**When to use:** Customers already approved for AWS KMS, require per-export data keys, and can store encrypted data keys alongside compliance logs.

## Template 2 – Envelope Encryption with Partner Broker
```js
export function createEnvelopeEncryptionHook({ signEndpoint, fetchImplementation = fetch }) {
  if (!signEndpoint) {
    throw new Error('[createEnvelopeEncryptionHook] `signEndpoint` is required.');
  }

  return async function encryptPayload(payload, { records, retentionPolicy }) {
    const response = await fetchImplementation(signEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'ENVELOPE_ENCRYPT',
        retentionPolicy,
        recordCount: records.length
      })
    });

    if (!response.ok) {
      throw new Error(`[createEnvelopeEncryptionHook] Signing service returned ${response.status}`);
    }

    const { encryptedPayload, algorithm, keyReference, additionalHeaders = {} } = await response.json();

    return {
      body: encryptedPayload,
      contentType: 'application/octet-stream',
      headers: {
        'x-adaptive-encryption': algorithm,
        'x-adaptive-key-reference': keyReference,
        ...additionalHeaders
      },
      metadata: {
        algorithm,
        keyReference,
        retentionPolicy
      }
    };
  };
}
```

**When to use:** Partners maintain a central signing/encryption broker (e.g., health network, trading desk) that must approve every export before it leaves an on-device vault.

## Metadata & Audit Guidance
- Always include a `retentionPolicy` entry in the returned metadata so downstream dashboards can verify export intent.
- Surface key identifiers (`kmsKeyId`, `keyReference`) to help compliance teams prove which controls protected each batch.
- Pair these hooks with `createRequestSigningMiddleware` to stamp signature headers that match the encryption artifacts for a full audit trail.

## Implementation Checklist
- [x] Provide AES-GCM + KMS wrapper example for on-device encryption.
- [x] Provide envelope encryption example for partner signing brokers.
- [ ] Add language-specific snippets (TypeScript, Python) for partners not using Node runtimes.
- [ ] Document key rotation strategy and deletion workflows per retention policy.

## Next Steps
1. Review these templates with legal/privacy stakeholders before distributing to external partners.
2. Publish provider configuration samples that call both `encryptPayload` and `registerTelemetryRequestMiddleware` so partners see the full pipeline.
3. Expand the playbook with decrypt/verify utilities for compliance auditors.
