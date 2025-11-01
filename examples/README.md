# VIB34D SDK Examples

Complete collection of examples demonstrating the VIB34D XR Quaternion SDK capabilities.

## 📚 Examples Index

### [01-basic-quaternion](./01-basic-quaternion/)
**Difficulty**: Beginner
**Topics**: Quaternion mathematics, normalization, axis-angle conversion

Learn fundamental quaternion operations and mathematics. Perfect starting point for understanding how quaternions work.

**What you'll learn:**
- Creating and manipulating quaternions
- Quaternion normalization
- Axis-angle to quaternion conversion
- Combining rotations

---

### [02-sensor-integration](./02-sensor-integration/)
**Difficulty**: Intermediate
**Topics**: XR sensors, device tracking, real-time data

Integrate AR/VR sensors with the SDK's Sensory Input Bridge. Demonstrates device tracking and pose estimation.

**What you'll learn:**
- AR visor sensor integration
- Real-time pose tracking
- Confidence weighting
- Event-driven sensor updates

---

### [03-4d-visualization](./03-4d-visualization/)
**Difficulty**: Advanced
**Topics**: 4D geometry, polytopes, GPU rendering

Render and interact with 4D polytopes using quaternion-driven rotations.

**What you'll learn:**
- 4D polytope projection
- 4D rotation controls (XW, YW, ZW planes)
- GPU-accelerated rendering
- Shader quaternion synchronization

---

### [04-license-setup](./04-license-setup/)
**Difficulty**: Intermediate
**Topics**: Commercial features, licensing, attestation

Configure enterprise licensing and remote license validation.

**What you'll learn:**
- License tier configuration
- Remote attestation setup
- Feature access control
- Commercialization analytics

---

### [05-react-integration](./05-react-integration/)
**Difficulty**: Intermediate
**Topics**: React, hooks, TypeScript

Integrate the SDK with React applications using custom hooks.

**What you'll learn:**
- React integration patterns
- Custom hooks for SDK
- TypeScript definitions
- Lifecycle management

---

## 🚀 Quick Start

### Running Examples Locally

Most examples are standalone HTML files:

```bash
cd examples/01-basic-quaternion
open index.html

# Or use a local server
python3 -m http.server 8080
# Visit http://localhost:8080
```

### Using with Your Project

Install the SDK:

```bash
npm install vib34d-xr-quaternion-sdk
```

Import and use:

```javascript
import { createAdaptiveSDK } from 'vib34d-xr-quaternion-sdk';

const sdk = createAdaptiveSDK({
  visualization: 'polychora',
  polytope: 'tesseract',
});
```

## 📖 Learning Path

**New to quaternions?**
Start with `01-basic-quaternion` → `02-sensor-integration`

**Building XR apps?**
`02-sensor-integration` → `03-4d-visualization`

**Enterprise deployment?**
`04-license-setup` → `05-react-integration`

**React developer?**
`05-react-integration` → `02-sensor-integration` → `03-4d-visualization`

## 🔗 Additional Resources

- **Documentation**: See `../DOCS/` directory
- **Main Demo**: `../wearable-designer.html`
- **API Reference**: `../DOCS/3-DEVELOPER-GUIDE.md`
- **Type Definitions**: `../types/adaptive-sdk.d.ts`

## 💡 Tips

1. **Start Simple**: Begin with basic examples before moving to advanced topics
2. **Use Browser DevTools**: Open console to see debug messages and errors
3. **Check Source Code**: Each example is well-commented for learning
4. **Experiment**: Modify parameters and see what happens
5. **Read Docs**: Reference documentation for deeper understanding

## 🐛 Troubleshooting

**Canvas not rendering?**
- Check browser console for WebGL errors
- Ensure browser supports WebGL 2.0

**Sensor data not updating?**
- Verify device permissions (motion sensors)
- Check that sensor is connected

**License validation fails?**
- Ensure valid license key
- Check network connection for remote attestation

## 📝 Contributing Examples

Have a useful example? Contributions welcome!

1. Create a new directory: `examples/06-your-example/`
2. Include `index.html` and `README.md`
3. Follow existing example structure
4. Submit a pull request

See `../CONTRIBUTING.md` for guidelines.

## 📄 License

All examples are provided under the same license as the SDK.
See `../DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md` for details.
