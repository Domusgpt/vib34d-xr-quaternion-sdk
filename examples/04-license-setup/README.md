# Example 4: License Setup

Configure enterprise licensing and remote attestation for the VIB34D SDK.

## License Tiers

The SDK supports three license tiers:

### Enterprise
- **Price**: $999/year
- **Devices**: Unlimited
- **Support**: Priority (24/7)
- **SLA**: 99.9% uptime
- **Features**: All features + custom branding

### Studio
- **Price**: $299/year
- **Devices**: Up to 10
- **Support**: Standard (business hours)
- **SLA**: 99.5% uptime
- **Features**: Multi-device, telemetry, analytics

### Indie
- **Price**: $49/year
- **Devices**: Up to 3
- **Support**: Community
- **SLA**: 99% uptime
- **Features**: Basic telemetry, limited analytics

## Usage Example

```javascript
import { createAdaptiveSDK } from 'vib34d-xr-quaternion-sdk';

const sdk = createAdaptiveSDK({
  license: {
    key: 'YOUR-LICENSE-KEY',
    tier: 'enterprise',
  },
  attestation: {
    url: 'https://license.yourcompany.com/validate',
    pollInterval: 3600000, // 1 hour
    failMode: 'closed', // or 'open'
  },
});

// Register license
await sdk.licenseManager.setLicense({
  key: 'YOUR-LICENSE-KEY',
  tier: 'enterprise',
  expiresAt: '2025-12-31T23:59:59Z',
  features: ['unlimited-devices', 'priority-support', 'custom-branding'],
});

// Validate license
const status = await sdk.licenseManager.validateLicense();

if (status.valid) {
  console.log('✓ License active');
  console.log('Tier:', status.tier);
  console.log('Expires:', status.expiresAt);
} else {
  console.error('✗ License invalid:', status.error);
}

// Listen for license events
sdk.licenseManager.on('license-activated', (event) => {
  console.log('License activated:', event.licenseKey);
});

sdk.licenseManager.on('license-expired', (event) => {
  console.error('License expired:', event.licenseKey);
});
```

## Remote Attestation

For enterprise deployments, enable remote license validation:

```javascript
sdk.licenseManager.registerRemoteAttestor({
  url: 'https://license.yourcompany.com/validate',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR-API-TOKEN',
  },
  pollInterval: 3600000, // Check every hour
  onAttested: (response) => {
    console.log('License attested:', response);
  },
  onRevoked: (response) => {
    console.error('License revoked:', response);
  },
});
```

## Commercialization Analytics

Track licensing KPIs:

```javascript
const reporter = sdk.licenseCommercializationReporter;

// Get adoption metrics
const metrics = reporter.getAdoptionMetrics();
console.log('Total licenses:', metrics.totalLicenses);
console.log('Active licenses:', metrics.activeLicenses);
console.log('By tier:', metrics.byTier);

// Export snapshots
const snapshot = reporter.captureSnapshot();
await reporter.exportSnapshot(snapshot, 'json'); // or 'csv'
```

## SDK Components

- `src/product/licensing/LicenseManager.js` - Core license management
- `src/product/licensing/RemoteLicenseAttestor.js` - Remote validation
- `src/product/licensing/LicenseCommercializationReporter.js` - Analytics
- `DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md` - Complete license guide

## Learn More

See `DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md` for detailed licensing documentation.
