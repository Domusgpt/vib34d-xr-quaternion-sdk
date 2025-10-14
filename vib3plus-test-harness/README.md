# Vib3+ Test Harness

**WebXR/WebGPU Playground for VIB34D XR Quaternion SDK**

A development and testing environment for the Vib3+ line, featuring interactive controls for exercising the full geometry tree and six-plane rotation flows.

## 🚀 Quick Start

```bash
# Install dependencies (already done during setup)
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🎯 Features

### SDK Integration Testing
- **Sensory Input Bridge**: Test quaternion channel distribution
- **Vib3+ Environment**: Exercise the curated base tree with 24 geometry presets
- **Shader Synchronizer**: Verify GPU-ready quaternion-to-matrix conversion

### Geometry Catalog
All 24 geometry/core pairings available for testing:
- Tetrahedron variations (Hypercube, Hypersphere, Hypertetra cores)
- Hypercube variations
- Sphere variations
- Torus variations
- Klein Bottle variations
- Fractal variations
- Wave variations
- Crystal variations

### WebXR/WebGPU Testing
- **WebXR Detection**: Automatic detection of immersive-vr session support
- **WebGPU Support Check**: Verify GPU adapter availability
- **4D Rotation Test**: Simulate quaternion data flow through the system

## 📖 Usage Notes

### Initialization Flow
1. Click "Initialize SDK" to create the Sensory Input Bridge and Vib3+ Environment
2. Select a geometry preset from the dropdown (0-23)
3. Click "Apply Geometry" to broadcast the geometry selection with six-plane rotation routing
4. Use "Test 4D Rotation" to simulate quaternion updates

### Console Access
The harness exposes a global `window.vib3Harness` object for direct console interaction:

```javascript
// Access the sensory input bridge
vib3Harness.bridge

// Access the Vib3+ environment
vib3Harness.environment

// Programmatically apply geometry
vib3Harness.applyGeometry()

// Test 4D rotation
vib3Harness.test4DRotation()
```

### WebGPU Requirements
For full GPU feature testing, use:
- Chrome Canary with `chrome://flags/#enable-unsafe-webgpu`
- Firefox Nightly with WebGPU enabled
- Safari 18+ (experimental WebGPU support)

### WebXR Requirements
For immersive XR testing, use:
- Meta Quest Browser
- Chrome with WebXR Device Emulator extension
- Firefox Reality
- Supported headsets (Quest, Vision Pro, etc.)

## 🧪 Testing Checklist

### Core Functionality
- [ ] SDK initializes without errors
- [ ] Sensory Input Bridge creates successfully
- [ ] Vib3+ Environment loads with 24 geometries
- [ ] Geometry selection updates correctly
- [ ] 4D rotation parameters route to all systems
- [ ] Console logging shows parameter updates

### WebGPU Integration
- [ ] WebGPU adapter detected
- [ ] WebGPU device requested successfully
- [ ] Shader uniform updates compile
- [ ] GPU memory allocation succeeds

### WebXR Integration
- [ ] WebXR session support detected
- [ ] Immersive-vr session launches
- [ ] Pose tracking quaternions flow to shader synchronizer
- [ ] Six-plane rotations update in real-time

### Performance
- [ ] Initialization completes in < 2 seconds
- [ ] Geometry switching is instant
- [ ] Quaternion updates maintain 60+ FPS
- [ ] Memory usage stays reasonable (< 500MB)

## 📂 Project Structure

```
vib3plus-test-harness/
├── index.html          # Main UI and layout
├── main.js             # SDK integration and controls
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## 🔧 Configuration

### Vite Configuration (Optional)
If you need custom Vite settings, create `vite.config.js`:

```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    https: false // Enable for WebXR on localhost
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
```

### HTTPS for Local WebXR
WebXR requires HTTPS. For local testing:

```bash
# Generate self-signed certificate (one-time)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Update vite.config.js
server: {
  https: {
    key: fs.readFileSync('./key.pem'),
    cert: fs.readFileSync('./cert.pem')
  }
}
```

## 📚 Documentation References

See the main SDK documentation:
- `../DOCS/ENVIRONMENT_AND_DEVELOPMENT_TRACK.md` - Development roadmap
- `../DOCS/QUATERNIONS_IN_XR.md` - XR quaternion integration
- `../DOCS/VISUALIZATION_PARAMETER_CONTRACT.md` - System interfaces
- `../DOCS/ADAPTIVE_SDK_DEVELOPER_HANDOFF_GUIDE.md` - Complete SDK guide

## 🌟 Integration Example

```javascript
import { SensoryInputBridge } from 'vib34d-xr-quaternion-sdk/sensors';
import createVib3PlusEnvironment from 'vib34d-xr-quaternion-sdk/vib3plus';

// Initialize
const bridge = new SensoryInputBridge();
const environment = createVib3PlusEnvironment({
  systems: { faceted, quantum, holographic }
});

// Connect bridge to environment
environment.createSynchronizer(bridge);

// Apply geometry preset
environment.applyGeometryIndex(12, { level: 1 }); // Torus + Hypercube

// Distribute quaternion data
bridge.distributeQuaternionChannels({
  'spatial.pose': {
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    position: { x: 0, y: 1.6, z: 0 }
  }
});
```

## 🐛 Troubleshooting

### SDK Not Initializing
- Check browser console for errors
- Verify package installation: `npm list vib34d-xr-quaternion-sdk`
- Ensure Node.js version matches `.nvmrc` (18.19.0)

### WebGPU Not Available
- Update browser to latest version
- Enable experimental features in browser flags
- Check GPU driver compatibility

### WebXR Session Fails
- Use HTTPS or localhost
- Ensure XR device is connected
- Check browser WebXR permissions

### Performance Issues
- Reduce geometry complexity
- Lower rendering resolution
- Disable telemetry in production builds

## 📝 License

This test harness is part of the VIB34D XR Quaternion SDK.
See `../DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md` for licensing details.

---

# 🌟 A Paul Phillips Manifestation

**Testing the future of 4D geometric processing in XR**

Send feedback: Paul@clearseassolutions.com
Join the movement: [Parserator.com](https://parserator.com)

> *"The Revolution Will Not be in a Structured Format"*

© 2025 Paul Phillips - Clear Seas Solutions LLC
