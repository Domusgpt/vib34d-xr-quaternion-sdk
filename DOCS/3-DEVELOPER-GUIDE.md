# VIB34D Developer Guide - Technical Reference & API
*Building the Next Generation of Visual Experiences*

## 🎯 Developer Overview

VIB34D is built with modern web technologies and follows best practices for performance, maintainability, and extensibility. This guide provides everything you need to understand, modify, and extend the system.

## 🚀 Quick Development Setup

### Prerequisites
- Node.js 16+ (for development tools)
- Modern browser with WebGL 2.0 support
- Basic understanding of JavaScript ES6+, WebGL, and GLSL

### Local Development
```bash
# Clone the repository
git clone https://github.com/Domusgpt/vib34d-ultimate-viewer.git
cd vib34d-ultimate-viewer

# Start development server
python3 -m http.server 8080
# or use Node.js
npx serve -p 8080

# Open browser
open http://localhost:8080
```

> **Preview tip:** `pnpm dev:web` boots the Vite-powered quaternion preview harness. Append query parameters such as `?system=polychora&preset=aurora-cascade&yaw=45&pitch=12&roll=-18` to pre-select a visualization engine, Storybook preset, or initial camera angles.

## 🧭 Phase 3 Visualization Recap

Phase 3 unified our visualization lifecycle, renderer defaults, and tooling surface so partners can exercise every engine without bespoke wiring:

- **Lifecycle helper.** `registerCanvasLifecycle` (also exported for partner documentation as `attachVisualizationLifecycle`) wraps the shared `CanvasManager` registration flow and guarantees each system tears down listeners cleanly. Engines call the helper during construction so focus/blur and resize activity stays synchronized.【F:src/core/registerCanvasLifecycle.js†L1-L21】【F:src/quantum/QuantumEngine.js†L9-L39】
- **Renderer defaults.** Glass materials, WebGPU/WebGL palette values, and blur resources are now centralized. The pipeline factory caches compiled programs and the blur helper reuses bind groups to eliminate redundant GPU work while keeping fallbacks visually aligned.【F:src/ui/adaptive/renderers/webgpu/GlassPipelineFactory.ts†L1-L86】【F:src/ui/adaptive/renderers/webgpu/LayerBlurHelper.ts†L1-L86】
- **Preview tooling.** The quaternion preview and Storybook controls expose the Polychora engine, rotor overrides, and cross-platform launch scripts (`pnpm dev:web`, `pnpm storybook`) so designers can validate presets alongside the runtime lifecycle bridge. Both commands now execute a preflight check that confirms Node version requirements and generated localization artifacts before launching the UI.【F:package.json†L57-L72】【F:tools/scripts/preflight.ts†L1-L106】【F:src/dev/quaternionPreview.ts†L1-L180】【F:src/stories/QuaternionPreview.stories.ts†L1-L90】

## 🧾 Phase 4 Commercialization & Telemetry Recap

- **Schema-first telemetry.** The `ProductTelemetryHarness` registers event schemas, enforces sanitization, and streams analytics summaries alongside commercialization KPIs so compliance reviewers have a single interface for consent, schema health, and attestation signals.【F:src/product/ProductTelemetryHarness.js†L639-L741】【F:src/product/ProductTelemetryHarness.js†L468-L534】
- **Snapshot persistence.** Commercialization snapshots default to redacting license keys, hydrate asynchronously, and expose exports that the SDK surfaces via helpers such as `captureLicenseCommercializationSnapshot()` and `exportLicenseCommercializationSnapshots()` for BI automation.【F:src/product/licensing/storage/CommercializationSnapshotStorageAdapters.js†L1-L142】【F:src/core/AdaptiveSDK.js†L247-L314】
- **Runbook updates.** The commercialization handbook outlines nightly capture recipes, on-demand reviews, and hydration fallbacks so enterprise teams can operationalize the telemetry stack without reverse-engineering implementation details.【F:DOCS/LICENSE_COMMERCIALIZATION_ANALYTICS.md†L1-L160】

## 🛠 Phase 5 Tooling & Automation

- **Preflight enforcement.** A reusable preflight script now guards `pnpm dev:web`, `pnpm storybook`, and CI entry points, checking Node version compatibility and ensuring generated localization artifacts are in sync before interactive tooling starts.【F:package.json†L57-L72】【F:tools/scripts/preflight.ts†L1-L106】
- **Deterministic code generation.** The localization code generator exposes reusable helpers so preflight checks and tests can verify artifacts without re-running CLI commands, and `pnpm codegen:localization` reuses the same module to refresh outputs.【F:tools/codegen/localization-quaternions.ts†L1-L106】【F:tools/scripts/runLocalizationCodegen.ts†L1-L26】
- **End-to-end smoke coverage.** New Vitest suites exercise the SDK bootstrap path and generated artifact validation, providing phase-five smoke assurance across telemetry, sensors, and quaternion registries.【F:tests/sdkSmoke.test.ts†L1-L82】【F:tests/localizationArtifacts.test.ts†L1-L20】

### Project Structure
```
vib34d-ultimate-viewer/
├── index.html              # Main engine with full controls
├── gallery.html            # Portfolio/collection system
├── viewer.html             # Single visualization focus
├── src/                    # Core source modules
│   ├── core/              # Engine core systems
│   ├── quantum/           # Quantum visualization system
│   ├── holograms/         # Holographic/audio system
│   ├── geometry/          # Geometric libraries
│   ├── export/            # Trading card generators
│   └── gallery/           # Collection management
├── js/                    # Interaction systems
│   ├── core/             # App controllers
│   ├── controls/         # UI handlers
│   ├── interactions/     # Device integration
│   └── audio/            # Audio processing
└── styles/               # CSS modules
```

## 🏗️ Core Architecture

### Module System
VIB34D uses ES6 modules for code organization. Here's the dependency graph:

```javascript
// Main Application Flow
index.html
├── src/core/Engine.js (Main engine controller)
├── src/core/Parameters.js (Parameter management)
├── src/core/ReactivityManager.js (Interaction handling)
├── src/core/CanvasManager.js (WebGL context management)
└── js/core/app.js (System switching logic)

// Visualization Systems
src/core/Visualizer.js (Faceted system)
src/quantum/QuantumEngine.js (Quantum system)
src/holograms/RealHolographicSystem.js (Holographic system)
src/core/PolychoraSystem.js (4D polytope system)

// Data & Export
src/gallery/GallerySystem.js (Collection management)
src/export/TradingCardGenerator.js (Card generation)
src/core/UnifiedSaveManager.js (Data persistence)
```

### System Switching Architecture

The core system switching logic in `js/core/app.js`:

```javascript
async function switchSystem(newSystem) {
    console.log(`🔄 Switching to ${newSystem} system`);
    
    // Cleanup current system
    if (window.currentEngine) {
        window.currentEngine.destroy();
    }
    
    // Update global state
    window.currentSystem = newSystem;
    
    // Initialize new system
    switch(newSystem) {
        case 'faceted':
            await initializeFacetedSystem();
            break;
        case 'quantum':
            await initializeQuantumSystem();
            break;
        case 'holographic':
            await initializeHolographicSystem();
            break;
        case 'polychora':
            await initializePolychoraSystem();
            break;
    }
    
    // Apply current parameters
    updateAllParameters();
}
```

## 🔧 API Reference

### Core Classes

#### VIB34DIntegratedEngine
*Main engine controller for the Faceted system*

```javascript
import { VIB34DIntegratedEngine } from './src/core/Engine.js';

const engine = new VIB34DIntegratedEngine();

// Methods
engine.init()                           // Initialize system
engine.updateParameter(name, value)     // Update single parameter
engine.updateParameters(params)         // Update multiple parameters
engine.randomizeAll()                  // Randomize all parameters
engine.resetAll()                      // Reset to defaults
engine.destroy()                       // Clean up resources
```

#### ParameterManager
*Centralized parameter control system*

```javascript
import { ParameterManager } from './src/core/Parameters.js';

const paramManager = new ParameterManager();

// Core parameters
const defaultParams = {
    geometry: 0,            // 0-7 geometry types
    rot4dXY: 0.0,          // -6.28 to 6.28 radians
    rot4dXZ: 0.0,          // -6.28 to 6.28 radians
    rot4dYZ: 0.0,          // -6.28 to 6.28 radians
    rot4dXW: 0.0,          // -6.28 to 6.28 radians
    rot4dYW: 0.0,          // -6.28 to 6.28 radians
    rot4dZW: 0.0,          // -6.28 to 6.28 radians
    gridDensity: 15,       // 5-100 tessellation level
    morphFactor: 1.0,      // 0-2 transformation amount
    chaos: 0.2,            // 0-1 randomization factor
    speed: 1.0,            // 0.1-3 animation multiplier
    hue: 200,              // 0-360 color wheel position
    intensity: 0.5,        // 0-1 brightness level
    saturation: 0.8        // 0-1 color richness
};

// Methods
paramManager.setParameter(name, value)  // Set single parameter
paramManager.getParameter(name)         // Get single parameter
paramManager.getAllParameters()         // Get all parameters
paramManager.validateParameter(name, value) // Validate parameter
paramManager.getParameterInfo(name)     // Get parameter metadata
```

#### DeviceTiltHandler
*Device orientation to 4D rotation mapping*

```javascript
import { DeviceTiltHandler } from './js/interactions/device-tilt.js';

const tiltHandler = new DeviceTiltHandler();

// Methods
await tiltHandler.enable()              // Enable device tilt
tiltHandler.disable()                   // Disable device tilt
tiltHandler.setSensitivity(0.5)         // Set sensitivity (0.1-3.0)
tiltHandler.setSmoothing(0.15)          // Set smoothing (0.01-1.0)
tiltHandler.updateBaseRotation(x,y,z)   // Set base rotation values
const status = tiltHandler.getStatus()  // Get current status

// Status object
{
    isSupported: boolean,
    isEnabled: boolean,
    sensitivity: number,
    smoothing: number,
    currentTilt: { alpha, beta, gamma },
    smoothedRotation: { rot4dXW, rot4dYW, rot4dZW },
    baseRotation: { rot4dXW, rot4dYW, rot4dZW }
}
```

#### UnifiedSaveManager
*Data persistence and variation management*

```javascript
import { UnifiedSaveManager } from './src/core/UnifiedSaveManager.js';

const saveManager = new UnifiedSaveManager();

// Methods
const variation = await saveManager.saveCurrentVariation(name, system, params);
const variations = saveManager.loadAllVariations();
const success = saveManager.deleteVariation(id);
const exported = saveManager.exportVariations();
const imported = saveManager.importVariations(data);

// Variation object structure
{
    id: 'unique-timestamp-id',
    name: 'User Creation Name',
    system: 'faceted|quantum|holographic|polychora',
    created: '2024-08-29T10:30:00.000Z',
    timestamp: 1693310600000,
    globalId: 42,
    parameters: { /* 11 core parameters */ },
    tags: ['favorite', 'shared'],
    metadata: { /* additional data */ }
}
```

### Global Functions

VIB34D exposes several global functions for UI integration:

```javascript
// System Control
switchSystem('faceted')                 // Switch visualization system
selectGeometry(3)                       // Set geometry type (0-7)
updateParameter('hue', 240)             // Update any parameter
randomizeAll()                          // Randomize all parameters
resetAll()                              // Reset to defaults

// Gallery & Export
saveToGallery()                         // Save current state
createTradingCard('classic')            // Generate trading card
showLLMInterface()                      // Show AI parameter interface

// Device Integration
enableDeviceTilt()                      // Enable device tilt
disableDeviceTilt()                     // Disable device tilt
toggleDeviceTilt()                      // Toggle device tilt

// Audio Integration (Holographic system)
toggleAudioInput()                      // Enable/disable microphone
setAudioSensitivity(0.8)               // Set audio sensitivity

// State Access
window.currentSystem                    // Currently active system
window.userParameterState               // Current parameter values
window.deviceTiltHandler                // Device tilt handler instance
```

## 🎨 Creating Custom Visualizations

### Adding a New System

1. **Create the Engine Class**
```javascript
// src/custom/CustomEngine.js
export class CustomEngine {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.params = {};
        this.startTime = Date.now();
    }
    
    async init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.gl = this.canvas.getContext('webgl2');
        // Initialize WebGL resources
    }
    
    updateParameter(name, value) {
        this.params[name] = value;
        // Update visualization
    }
    
    render() {
        // Render frame
        requestAnimationFrame(() => this.render());
    }
    
    destroy() {
        // Clean up resources
    }
}
```

2. **Register with System Switcher**
```javascript
// In js/core/app.js
import { CustomEngine } from '../src/custom/CustomEngine.js';

async function initializeCustomSystem() {
    const engine = new CustomEngine();
    await engine.init('main-canvas');
    window.currentEngine = engine;
    engine.render();
}

// Add to switchSystem function
case 'custom':
    await initializeCustomSystem();
    break;
```

3. **Add UI Controls**
```javascript
// In index.html
<button onclick="switchSystem('custom')" class="system-btn custom">
    🎆 CUSTOM
</button>
```

### Shader Development

VIB34D uses GLSL shaders for rendering. Here's a template:

```glsl
// Vertex Shader
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
}

// Fragment Shader
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_geometry;
uniform float u_gridDensity;
uniform float u_morphFactor;
uniform float u_chaos;
uniform float u_speed;
uniform float u_hue;
uniform float u_intensity;
uniform float u_saturation;
uniform float u_rot4dXW;
uniform float u_rot4dYW;
uniform float u_rot4dZW;

varying vec2 v_texCoord;

// Your custom visualization logic here
void main() {
    vec2 st = v_texCoord;
    vec3 color = vec3(0.0);
    
    // Custom rendering logic
    
    gl_FragColor = vec4(color, 1.0);
}
```

### Parameter Integration

Add custom parameters to the system:

```javascript
// In src/core/Parameters.js
const customParameters = {
    customParam1: {
        min: 0,
        max: 10,
        default: 5,
        step: 0.1,
        description: 'Custom parameter description'
    }
};

// Add to parameter validation
validateParameter(name, value) {
    if (name in customParameters) {
        const param = customParameters[name];
        return Math.max(param.min, Math.min(param.max, value));
    }
    // ... existing validation
}
```

## 📱 Mobile Development

### Touch Event Handling
```javascript
// Touch-optimized event handlers
function handleTouchStart(event) {
    event.preventDefault();
    const touch = event.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    
    updateMousePosition(x, y);
}

// Add to canvas
canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
```

### Performance Optimization
```javascript
// Mobile-specific optimizations
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile) {
    // Reduce rendering complexity
    defaultParams.gridDensity = Math.min(defaultParams.gridDensity, 30);
    
    // Use lower precision
    const contextOptions = {
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance'
    };
    
    // Cap frame rate
    let lastFrameTime = 0;
    const targetFrameTime = 1000 / 30; // 30 FPS
    
    function renderWithFrameCap() {
        const now = Date.now();
        if (now - lastFrameTime >= targetFrameTime) {
            render();
            lastFrameTime = now;
        }
        requestAnimationFrame(renderWithFrameCap);
    }
}
```

## 🔄 Data Flow & State Management

### Parameter Updates
```javascript
// Parameter flow: UI → ParameterManager → Engine → WebGL
User Input → updateParameter() → validateParameter() → 
engine.updateParameter() → updateUniforms() → GPU
```

### Save System Flow
```javascript
// Save flow: Engine → JSON → localStorage → Gallery
getCurrentState() → createVariation() → saveToStorage() → 
updateGallery() → triggerGalleryRefresh()
```

### Cross-Window Communication
```javascript
// Gallery ↔ Viewer communication
// In gallery.html
function openInViewer(params) {
    const url = `viewer.html?${params.toString()}`;
    window.open(url, '_blank');
}

// In viewer.html
function parseURLParameters() {
    const params = new URLSearchParams(window.location.search);
    // Parse and apply parameters
}

// Parent ↔ Iframe communication
window.addEventListener('message', (event) => {
    if (event.data.type === 'parameterUpdate') {
        updateParameter(event.data.param, event.data.value);
    }
});
```

## 🧪 Testing & Debugging

### Debug Mode
```javascript
// Enable debug mode
window.VIB34D_DEBUG = true;

// Debug utilities
function debugLog(message, data) {
    if (window.VIB34D_DEBUG) {
        console.log(`[VIB34D] ${message}`, data);
    }
}

// Performance monitoring
function trackPerformance(label, fn) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    debugLog(`Performance: ${label}`, `${(end - start).toFixed(2)}ms`);
    return result;
}
```

### WebGL Debug Tools
```javascript
// WebGL error checking
function checkGLError(gl, operation) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        console.error(`WebGL Error in ${operation}: ${error}`);
    }
}

// Shader compilation debugging
function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        console.error('Shader compilation error:', log);
        console.error('Source:', source);
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}
```

### Unit Testing
```javascript
// Example test structure
describe('ParameterManager', () => {
    let paramManager;
    
    beforeEach(() => {
        paramManager = new ParameterManager();
    });
    
    test('should validate parameter ranges', () => {
        expect(paramManager.validateParameter('hue', 400)).toBe(360);
        expect(paramManager.validateParameter('hue', -10)).toBe(0);
    });
    
    test('should set parameters correctly', () => {
        paramManager.setParameter('gridDensity', 50);
        expect(paramManager.getParameter('gridDensity')).toBe(50);
    });
});
```

## 🚀 Deployment & Distribution

### Build Process
```bash
# Minify and optimize for production
npm run build

# Test production build
npm run serve:production

# Deploy to GitHub Pages
git add -A
git commit -m "Production build"
git push origin main
```

### Performance Monitoring
```javascript
// Performance metrics
const metrics = {
    frameRate: 0,
    memoryUsage: 0,
    renderTime: 0
};

function updateMetrics() {
    metrics.frameRate = 1000 / deltaTime;
    metrics.memoryUsage = performance.memory?.usedJSHeapSize || 0;
    metrics.renderTime = lastRenderTime;
    
    // Log metrics periodically
    if (window.VIB34D_DEBUG) {
        console.log('Metrics:', metrics);
    }
}
```

### Browser Compatibility
```javascript
// Feature detection
const features = {
    webgl2: !!canvas.getContext('webgl2'),
    webgl: !!canvas.getContext('webgl'),
    deviceMotion: 'DeviceMotionEvent' in window,
    deviceOrientation: 'DeviceOrientationEvent' in window,
    audioContext: !!(window.AudioContext || window.webkitAudioContext)
};

// Graceful degradation
if (!features.webgl2 && features.webgl) {
    console.warn('WebGL 2.0 not available, using WebGL 1.0');
    // Use WebGL 1.0 shaders
}
```

## 🔮 Extension Points

### Plugin Architecture
```javascript
// Plugin interface
class VIB34DPlugin {
    constructor(name, version) {
        this.name = name;
        this.version = version;
    }
    
    onInit(engine) {
        // Plugin initialization
    }
    
    onParameterUpdate(name, value) {
        // React to parameter changes
    }
    
    onRender(context) {
        // Custom rendering
    }
    
    onDestroy() {
        // Cleanup
    }
}

// Plugin registration
window.VIB34D = window.VIB34D || {};
window.VIB34D.registerPlugin = function(plugin) {
    this.plugins = this.plugins || [];
    this.plugins.push(plugin);
};
```

### Custom Export Formats
```javascript
// Add custom export format
class CustomExporter {
    export(variation, options) {
        // Generate custom format
        return {
            success: true,
            data: customData,
            filename: `${variation.name}.custom`
        };
    }
}

// Register exporter
ExportManager.registerFormat('custom', new CustomExporter());
```

---

*This developer guide provides the foundation for building upon and extending VIB34D. The system is designed to be modular, extensible, and performant across all target platforms.*

**Happy Coding! 🚀💻**