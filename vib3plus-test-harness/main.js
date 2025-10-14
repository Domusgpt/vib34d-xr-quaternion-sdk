/**
 * Vib3+ Test Harness - WebXR/WebGPU Playground
 *
 * A Paul Phillips Manifestation
 * Testing environment for VIB34D XR Quaternion SDK
 */

import { SensoryInputBridge } from 'vib34d-xr-quaternion-sdk/sensors';

// State management
let bridge = null;
let environment = null;
let initialized = false;

// DOM elements
const initButton = document.getElementById('initButton');
const applyGeometryButton = document.getElementById('applyGeometryButton');
const rotateButton = document.getElementById('rotateButton');
const xrButton = document.getElementById('xrButton');
const webgpuButton = document.getElementById('webgpuButton');
const geometrySelect = document.getElementById('geometrySelect');
const statusDisplay = document.getElementById('status');
const canvas = document.getElementById('renderCanvas');

// Update status display
function updateStatus(message, ready = false) {
    statusDisplay.textContent = message;
    statusDisplay.className = ready ? 'status ready' : 'status';
    console.log(`[Vib3+ Harness] ${message}`);
}

// Initialize SDK
async function initializeSDK() {
    try {
        updateStatus('Initializing SDK...');

        // Create sensory input bridge
        bridge = new SensoryInputBridge();
        updateStatus('Sensory Input Bridge created', false);

        // Dynamic import of Vib3+ environment (if available)
        try {
            const { default: createVib3PlusEnvironment } = await import('vib34d-xr-quaternion-sdk/vib3plus');

            // For this test harness, we'll create mock systems
            // In a real app, you'd provide actual faceted, quantum, and holographic systems
            const mockSystems = {
                faceted: createMockSystem('Faceted'),
                quantum: createMockSystem('Quantum'),
                holographic: createMockSystem('Holographic')
            };

            environment = createVib3PlusEnvironment({ systems: mockSystems });
            environment.createSynchronizer(bridge);

            updateStatus('Vib3+ Environment ready', true);
            applyGeometryButton.disabled = false;
            rotateButton.disabled = false;
            initialized = true;

        } catch (err) {
            console.warn('Vib3+ environment not available, using basic integration:', err);
            updateStatus('SDK initialized (basic mode)', true);
            initialized = true;
        }

        initButton.textContent = '✓ SDK Initialized';
        initButton.disabled = true;

    } catch (error) {
        console.error('Initialization failed:', error);
        updateStatus('Initialization failed: ' + error.message, false);
    }
}

// Create mock visualization system for testing
function createMockSystem(name) {
    return {
        name,
        updateParameter: (paramName, value, context) => {
            console.log(`[${name}] Parameter update:`, paramName, '=', value);
        },
        batchUpdate: (paramMap) => {
            console.log(`[${name}] Batch update:`, paramMap);
        }
    };
}

// Apply selected geometry
async function applyGeometry() {
    if (!initialized) {
        updateStatus('SDK not initialized', false);
        return;
    }

    const geometryIndex = parseInt(geometrySelect.value);
    updateStatus(`Applying geometry preset ${geometryIndex}...`);

    try {
        if (environment && typeof environment.applyGeometryIndex === 'function') {
            // Use Vib3+ environment method
            environment.applyGeometryIndex(geometryIndex, { level: 1 });
            updateStatus(`Geometry ${geometryIndex} applied via Vib3+`, true);
        } else {
            // Manual geometry application
            console.log('Applying geometry manually:', geometryIndex);
            updateStatus(`Geometry ${geometryIndex} selected (manual mode)`, true);
        }
    } catch (error) {
        console.error('Geometry application failed:', error);
        updateStatus('Geometry application failed', false);
    }
}

// Test 4D rotation
function test4DRotation() {
    if (!initialized) {
        updateStatus('SDK not initialized', false);
        return;
    }

    updateStatus('Testing 4D rotation...');

    // Simulate quaternion data
    const mockQuaternion = {
        x: 0.5,
        y: 0.5,
        z: 0.5,
        w: 0.5
    };

    try {
        // Test quaternion distribution through the bridge
        if (bridge && typeof bridge.distributeQuaternionChannels === 'function') {
            bridge.distributeQuaternionChannels({
                'spatial.pose': {
                    orientation: mockQuaternion,
                    position: { x: 0, y: 0, z: 0 }
                }
            });
            updateStatus('4D rotation test completed', true);
        } else {
            console.log('Bridge not fully configured, simulating rotation');
            updateStatus('4D rotation simulated (no bridge)', true);
        }
    } catch (error) {
        console.error('Rotation test failed:', error);
        updateStatus('Rotation test failed', false);
    }
}

// Check WebGPU support
async function checkWebGPU() {
    updateStatus('Checking WebGPU support...');

    if (!navigator.gpu) {
        alert('WebGPU is not supported in this browser.\n\nTry:\n• Chrome Canary\n• Firefox Nightly\n• Enable chrome://flags/#enable-unsafe-webgpu');
        updateStatus('WebGPU not available', false);
        return;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            const device = await adapter.requestDevice();
            console.log('WebGPU device:', device);
            alert('✓ WebGPU is supported!\n\nAdapter: ' + (adapter.name || 'Default'));
            updateStatus('WebGPU available', true);
        } else {
            alert('WebGPU adapter could not be requested');
            updateStatus('WebGPU adapter unavailable', false);
        }
    } catch (error) {
        console.error('WebGPU check failed:', error);
        alert('WebGPU check failed: ' + error.message);
        updateStatus('WebGPU check failed', false);
    }
}

// Check WebXR support
function checkWebXR() {
    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
            if (supported) {
                xrButton.textContent = 'Enter WebXR';
                xrButton.disabled = false;
                xrButton.onclick = enterXR;
            } else {
                console.log('WebXR VR not supported');
            }
        });
    }
}

// Enter XR session (placeholder)
async function enterXR() {
    updateStatus('Entering WebXR...');
    try {
        const session = await navigator.xr.requestSession('immersive-vr');
        console.log('XR session started:', session);
        updateStatus('WebXR session active', true);
    } catch (error) {
        console.error('XR session failed:', error);
        updateStatus('XR session failed', false);
    }
}

// Event listeners
initButton.addEventListener('click', initializeSDK);
applyGeometryButton.addEventListener('click', applyGeometry);
rotateButton.addEventListener('click', test4DRotation);
webgpuButton.addEventListener('click', checkWebGPU);

// Initialize canvas
function initCanvas() {
    const ctx = canvas.getContext('2d');
    if (ctx) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        // Draw placeholder
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#00ffcc44';
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

        ctx.fillStyle = '#00ffcc';
        ctx.font = '24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('VIB34D XR Quaternion SDK', canvas.width / 2, canvas.height / 2 - 20);

        ctx.fillStyle = '#888';
        ctx.font = '16px monospace';
        ctx.fillText('Initialize to begin visualization', canvas.width / 2, canvas.height / 2 + 20);
    }
}

// Handle window resize
window.addEventListener('resize', () => {
    if (canvas) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
});

// Initialize on load
window.addEventListener('load', () => {
    initCanvas();
    checkWebXR();
    updateStatus('Ready to initialize', false);
    console.log('%c🌟 Vib3+ Test Harness Ready', 'color: #00ffcc; font-size: 20px; font-weight: bold;');
    console.log('A Paul Phillips Manifestation - VIB34D XR Quaternion SDK');
});

// Export for console access
window.vib3Harness = {
    bridge,
    environment,
    applyGeometry,
    test4DRotation
};
