# Example 5: React Integration

Integrate VIB34D XR Quaternion SDK with React applications.

## Installation

```bash
npm install vib34d-xr-quaternion-sdk
```

## Basic Usage

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { createAdaptiveSDK } from 'vib34d-xr-quaternion-sdk';

function XRVisualization() {
  const canvasRef = useRef(null);
  const sdkRef = useRef(null);
  const [sensorData, setSensorData] = useState(null);

  useEffect(() => {
    // Initialize SDK
    const sdk = createAdaptiveSDK({
      canvas: canvasRef.current,
      visualization: 'polychora',
      polytope: 'tesseract',
    });

    sdkRef.current = sdk;

    // Subscribe to sensor updates
    const unsubscribe = sdk.sensoryInputBridge.subscribe('spatial', (data) => {
      setSensorData(data);
    });

    // Start rendering
    sdk.start();

    return () => {
      unsubscribe();
      sdk.stop();
    };
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} width={800} height={600} />

      {sensorData && (
        <div className="sensor-info">
          <h3>Sensor Data</h3>
          <p>Position: ({sensorData.position.x.toFixed(2)},
                        {sensorData.position.y.toFixed(2)},
                        {sensorData.position.z.toFixed(2)})</p>
          <p>Confidence: {(sensorData.confidence * 100).toFixed(0)}%</p>
        </div>
      )}
    </div>
  );
}

export default XRVisualization;
```

## Custom Hook

Create a reusable hook for the SDK:

```jsx
import { useEffect, useRef, useState } from 'react';
import { createAdaptiveSDK } from 'vib34d-xr-quaternion-sdk';

export function useVIB34D(config) {
  const sdkRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const sdk = createAdaptiveSDK(config);
      sdkRef.current = sdk;
      setIsReady(true);
    } catch (err) {
      setError(err);
    }

    return () => {
      if (sdkRef.current) {
        sdkRef.current.stop();
      }
    };
  }, []);

  return {
    sdk: sdkRef.current,
    isReady,
    error,
  };
}

// Usage
function App() {
  const { sdk, isReady, error } = useVIB34D({
    visualization: 'polychora',
    polytope: 'tesseract',
  });

  if (error) return <div>Error: {error.message}</div>;
  if (!isReady) return <div>Loading SDK...</div>;

  return <XRVisualization sdk={sdk} />;
}
```

## Sensor Integration Hook

```jsx
import { useEffect, useState } from 'react';

export function useSensorData(sdk, channel = 'spatial') {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!sdk) return;

    const unsubscribe = sdk.sensoryInputBridge.subscribe(channel, setData);
    return unsubscribe;
  }, [sdk, channel]);

  return data;
}

// Usage
function SensorDisplay({ sdk }) {
  const spatialData = useSensorData(sdk, 'spatial');

  return (
    <div>
      {spatialData && (
        <div>
          <h3>Spatial Data</h3>
          <p>Orientation: {JSON.stringify(spatialData.orientation)}</p>
        </div>
      )}
    </div>
  );
}
```

## License Management in React

```jsx
import { useEffect, useState } from 'react';

function LicenseProvider({ children, licenseKey }) {
  const [licenseStatus, setLicenseStatus] = useState('checking');
  const [sdk, setSdk] = useState(null);

  useEffect(() => {
    async function initializeLicense() {
      const sdk = createAdaptiveSDK({
        license: { key: licenseKey },
      });

      const status = await sdk.licenseManager.validateLicense();

      if (status.valid) {
        setLicenseStatus('active');
        setSdk(sdk);
      } else {
        setLicenseStatus('invalid');
      }
    }

    initializeLicense();
  }, [licenseKey]);

  if (licenseStatus === 'checking') {
    return <div>Validating license...</div>;
  }

  if (licenseStatus === 'invalid') {
    return <div>Invalid license. Please contact support.</div>;
  }

  return children;
}
```

## TypeScript Support

The SDK includes full TypeScript definitions:

```tsx
import { createAdaptiveSDK, AdaptiveSDKConfig } from 'vib34d-xr-quaternion-sdk';

const config: AdaptiveSDKConfig = {
  visualization: 'polychora',
  polytope: 'tesseract',
  license: {
    key: 'YOUR-LICENSE-KEY',
    tier: 'enterprise',
  },
};

const sdk = createAdaptiveSDK(config);
```

## Example Project Structure

```
my-xr-app/
├── src/
│   ├── components/
│   │   ├── XRVisualization.jsx
│   │   ├── SensorPanel.jsx
│   │   └── LicenseProvider.jsx
│   ├── hooks/
│   │   ├── useVIB34D.js
│   │   └── useSensorData.js
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── vite.config.js
```

## Next Steps

- See `DOCS/ADAPTIVE_SDK_DEVELOPER_HANDOFF_GUIDE.md` for complete API documentation
- Explore other examples for specific features
- Check `types/adaptive-sdk.d.ts` for TypeScript definitions

## Related Frameworks

The SDK works with:
- **React** (this example)
- **Vue.js** - Similar pattern with `ref()` and `onMounted()`
- **Angular** - Use in component `ngOnInit()` lifecycle
- **Svelte** - Use in `onMount()` lifecycle
- **Vanilla JS** - Direct usage (see other examples)
