# Example 3: 4D Visualization

Real-time 4D polytope rendering using quaternions for 4D rotations.

## Features

- 4D polytope projection (tesseract, 5-cell, 24-cell, etc.)
- Interactive 4D rotation controls
- GPU-accelerated rendering
- Real-time quaternion-driven transformations

## Running

```bash
# For a complete 4D visualization demo, see:
open ../../wearable-designer.html
```

The main SDK demo (`wearable-designer.html`) includes a full 4D visualization system with:

- Multiple polytope types (tesseract, 5-cell, 16-cell, 24-cell, 120-cell, 600-cell)
- 4D rotation controls (XW, YW, ZW planes)
- Projection modes (perspective, orthographic)
- Shader quaternion synchronization

## Key Concepts

### 4D Rotations

In 4D space, we have 6 rotation planes:
- **XY, XZ, YZ** - Standard 3D rotations
- **XW, YW, ZW** - 4D rotations into the W-axis

The SDK maps XR device quaternions to 4D rotation parameters:

```javascript
{
  rot4dXW: quaternion.x * motionEnergy,
  rot4dYW: quaternion.y * motionEnergy,
  rot4dZW: quaternion.z * motionEnergy,
}
```

### Polytope Projection

4D polytopes are projected to 3D using perspective division:

```javascript
point3D.x = point4D.x / (distance - point4D.w)
point3D.y = point4D.y / (distance - point4D.w)
point3D.z = point4D.z / (distance - point4D.w)
```

## SDK Components

- `src/core/PolychoraSystem.js` - 4D polytope engine
- `src/geometry/GeometryLibrary.js` - 4D mathematics
- `src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js` - GPU quaternion processing
- `src/physics/Polychora4DPhysics.js` - 4D physics simulation

## Try It

```bash
cd ../..
python3 -m http.server 8080
# Open http://localhost:8080/wearable-designer.html
# Select "Polychora" system and try different polytopes
```
