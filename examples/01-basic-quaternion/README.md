# Example 1: Basic Quaternion Operations

This example demonstrates fundamental quaternion mathematics using the VIB34D XR Quaternion SDK.

## What You'll Learn

- How to create and manipulate quaternions
- Quaternion normalization
- Creating quaternions from axis-angle representations
- Multiplying quaternions for combined rotations

## Running the Example

Simply open `index.html` in your web browser:

```bash
cd examples/01-basic-quaternion
open index.html  # macOS
# or
start index.html # Windows
# or
xdg-open index.html # Linux
```

Or use a local server:

```bash
python3 -m http.server 8080
# Then visit: http://localhost:8080
```

## Code Walkthrough

### Creating a Quaternion

```javascript
const q = new Quaternion(1, 2, 3, 4);
// Creates quaternion with x=1, y=2, z=3, w=4
```

### Normalizing a Quaternion

```javascript
const normalized = q.normalize();
// Returns a unit quaternion (magnitude = 1)
```

### Rotation from Axis-Angle

```javascript
const axis = { x: 0, y: 1, z: 0 }; // Y-axis
const angle = Math.PI / 2; // 90 degrees
const rotation = Quaternion.fromAxisAngle(axis, angle);
```

### Combining Rotations

```javascript
const combined = q1.multiply(q2);
// Combines two rotations into one
```

## Key Concepts

**Quaternions** are a mathematical representation of rotations in 3D space. They consist of four components (x, y, z, w) and offer several advantages over Euler angles:

- No gimbal lock
- Smooth interpolation (SLERP)
- Efficient composition of rotations
- Used extensively in XR/VR applications

## Next Steps

- **Example 2**: AR Sensor Integration - See how quaternions work with real XR devices
- **Example 3**: 4D Visualization - Explore 4D rotations with quaternions
- **Documentation**: Read `DOCS/QUATERNIONS_IN_XR.md` for in-depth theory

## Related SDK Components

- `src/geometry/GeometryLibrary.js` - 4D geometric mathematics
- `src/ui/adaptive/renderers/ShaderQuaternionSynchronizer.js` - GPU quaternion processing
