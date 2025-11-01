# Example 2: AR Sensor Integration

Demonstrates XR sensor normalization and real-time device tracking using the VIB34D Sensory Input Bridge.

## Features

- AR Visor sensor simulation
- Real-time pose tracking (position + orientation)
- Quaternion normalization
- Confidence weighting
- Event-driven architecture

## Running

```bash
open index.html
# or use a local server
python3 -m http.server 8080
```

## Key Concepts

### Sensory Input Bridge

The SDK's Sensory Input Bridge normalizes data from heterogeneous XR devices into a unified format:

```javascript
{
  position: { x, y, z },
  orientation: { x, y, z, w }, // normalized quaternion
  confidence: 0.95,  // 0-1 reliability score
  timestamp: Date.now()
}
```

### Device Adapters

The SDK provides adapters for different device types:
- **AR Visor** - Spatial tracking, pose data
- **Neural Band** - Brain activity patterns
- **Biometric Wrist** - Heart rate, motion

### Confidence Weighting

When multiple sensors provide data, the SDK fuses them using confidence weighting:

```javascript
fusedValue = (value1 * confidence1 + value2 * confidence2) / totalConfidence
```

## Related SDK Components

- `src/ui/adaptive/SensoryInputBridge.js` - Main sensor coordination
- `src/ui/adaptive/sensors/ARVisorWearableAdapter.js` - AR visor implementation
- `src/ui/adaptive/sensors/SensorSchemaRegistry.js` - Schema normalization
