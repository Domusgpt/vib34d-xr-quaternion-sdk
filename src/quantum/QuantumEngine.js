/**
 * VIB34D Quantum Engine
 * Manages the enhanced quantum system with complex 3D lattice functions
 */

import { QuantumHolographicVisualizer } from './QuantumVisualizer.js';
import { ParameterManager } from '../core/Parameters.js';
import { GeometryLibrary } from '../geometry/GeometryLibrary.js';
import { registerCanvasLifecycle } from '../core/registerCanvasLifecycle.js';

export class QuantumEngine {
    constructor() {
        console.log('🔮 Initializing VIB34D Quantum Engine...');
        
        this.visualizers = [];
        this.parameters = new ParameterManager();
        this.isActive = false;
        this.canvasLifecycleCleanup = null;
        
        // REMOVED: Built-in reactivity - ReactivityManager handles all interactions now
        
        // Initialize with quantum-enhanced defaults
        this.parameters.setParameter('hue', 280); // Purple-blue for quantum
        this.parameters.setParameter('intensity', 0.7); // Higher intensity
        this.parameters.setParameter('saturation', 0.9); // More vivid
        this.parameters.setParameter('gridDensity', 20); // Denser patterns
        this.parameters.setParameter('morphFactor', 1.0);
        
        this.init();

        this.canvasLifecycleCleanup = registerCanvasLifecycle('quantum', {
            applyRotor: rotor => this.setRotorState(rotor),
            onActivate: () => this.setActive(true),
            onDeactivate: () => this.setActive(false),
        });
    }
    
    /**
     * Initialize the quantum system
     */
    init() {
        this.createVisualizers();
        this.setupAudioReactivity();
        // REMOVED: Built-in gesture reactivity - ReactivityManager handles all interactions
        this.startRenderLoop();
        console.log('✨ Quantum Engine initialized with audio reactivity');
    }
    
    /**
     * Create quantum visualizers for all 5 layers
     */
    createVisualizers() {
        const layers = [
            { id: 'quantum-background-canvas', role: 'background', reactivity: 0.4 },
            { id: 'quantum-shadow-canvas', role: 'shadow', reactivity: 0.6 },
            { id: 'quantum-content-canvas', role: 'content', reactivity: 1.0 },
            { id: 'quantum-highlight-canvas', role: 'highlight', reactivity: 1.3 },
            { id: 'quantum-accent-canvas', role: 'accent', reactivity: 1.6 }
        ];
        
        layers.forEach(layer => {
            try {
                // Canvas elements should already exist in HTML
                const canvas = document.getElementById(layer.id);
                if (!canvas) {
                    console.warn(`⚠️ Canvas ${layer.id} not found in DOM - skipping`);
                    return;
                }
                
                const visualizer = new QuantumHolographicVisualizer(layer.id, layer.role, layer.reactivity, 0);
                if (visualizer.gl) {
                    this.visualizers.push(visualizer);
                    console.log(`🌌 Created quantum layer: ${layer.role}`);
                } else {
                    console.warn(`⚠️ No WebGL context for quantum layer ${layer.id}`);
                }
            } catch (error) {
                console.warn(`Failed to create quantum layer ${layer.id}:`, error);
            }
        });
        
        console.log(`✅ Created ${this.visualizers.length} quantum visualizers with enhanced effects`);
    }
    
    /**
     * Set system active/inactive
     */
    setActive(active) {
        this.isActive = active;
        
        if (active) {
            // Show quantum layers
            const quantumLayers = document.getElementById('quantumLayers');
            if (quantumLayers) {
                quantumLayers.style.display = 'block';
            }
            
            // Enable audio if global audio is enabled
            if (window.audioEnabled && !this.audioEnabled) {
                this.enableAudio();
            }
            
            console.log('🔮 Quantum System ACTIVATED - Audio frequency reactivity mode');
        } else {
            // Hide quantum layers
            const quantumLayers = document.getElementById('quantumLayers');
            if (quantumLayers) {
                quantumLayers.style.display = 'none';
            }
            console.log('🔮 Quantum System DEACTIVATED');
        }
    }
    
    // Method to be called when global audio is toggled
    toggleAudio(enabled) {
        if (enabled && this.isActive && !this.audioEnabled) {
            this.enableAudio();
        } else if (!enabled && this.audioEnabled) {
            // Disable audio
            this.audioEnabled = false;
            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }
            console.log('🔇 Quantum audio reactivity disabled');
        }
    }
    
    /**
     * Setup audio frequency reactivity for Quantum system
     */
    setupAudioReactivity() {
        console.log('🌌 Setting up Quantum audio frequency reactivity');
        // Audio setup will be triggered when audio is enabled
    }
    
    // REMOVED: All built-in reactivity methods - ReactivityManager handles everything
    
    async enableAudio() {
        if (this.audioEnabled) return;
        
        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Create audio context and analyser
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            
            // Configure analyser for frequency analysis
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Connect microphone to analyser
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            
            this.audioEnabled = true;
            console.log('🎵 Quantum audio reactivity enabled');
            
        } catch (error) {
            console.error('❌ Failed to enable Quantum audio:', error);
            this.audioEnabled = false;
        }
    }
    
    /**
     * Update parameter across all quantum visualizers with enhanced integration
     */
    updateParameter(param, value) {
        // Update internal parameter manager
        this.parameters.setParameter(param, value);
        
        // CRITICAL: Apply to all quantum visualizers with immediate render
        this.visualizers.forEach(visualizer => {
            if (visualizer.updateParameters) {
                const params = {};
                params[param] = value;
                visualizer.updateParameters(params);
            } else {
                // Fallback: direct parameter update with manual render
                if (visualizer.params) {
                    visualizer.params[param] = value;
                    if (visualizer.render) {
                        visualizer.render();
                    }
                }
            }
        });
        
        console.log(`🔮 Updated quantum ${param}: ${value}`);
    }
    
    /**
     * Update multiple parameters
     */
    updateParameters(params) {
        Object.keys(params).forEach(param => {
            this.updateParameter(param, params[param]);
        });
    }

    setRotorState(rotor) {
        if (!rotor) {
            return;
        }

        const state = Array.isArray(rotor)
            ? {
                xy: rotor[0],
                xz: rotor[1],
                yz: rotor[2],
                xw: rotor[3],
                yw: rotor[4],
                zw: rotor[5]
            }
            : rotor;

        this.updateParameters({
            rot4dXY: Number(state.xy ?? state.xY ?? 0) || 0,
            rot4dXZ: Number(state.xz ?? state.xZ ?? 0) || 0,
            rot4dYZ: Number(state.yz ?? state.yZ ?? 0) || 0,
            rot4dXW: Number(state.xw ?? state.xW ?? 0) || 0,
            rot4dYW: Number(state.yw ?? state.yW ?? 0) || 0,
            rot4dZW: Number(state.zw ?? state.zW ?? 0) || 0,
        });
    }
    
    /**
     * Update mouse interaction
     */
    updateInteraction(x, y, intensity) {
        this.visualizers.forEach(visualizer => {
            if (visualizer.updateInteraction) {
                visualizer.updateInteraction(x, y, intensity);
            }
        });
    }
    
    /**
     * Get current parameters for saving/export
     */
    getParameters() {
        return this.parameters.getAllParameters();
    }
    
    /**
     * Set parameters from loaded/imported data
     */
    setParameters(params) {
        Object.keys(params).forEach(param => {
            this.parameters.setParameter(param, params[param]);
        });
        this.updateParameters(params);
    }
    
    /**
     * Start the render loop
     */
    startRenderLoop() {
        if (window.mobileDebug) {
            window.mobileDebug.log(`🎬 Quantum Engine: Starting render loop with ${this.visualizers?.length} visualizers, isActive=${this.isActive}`);
        }
        
        const render = () => {
            if (this.isActive) {
                // MVEP-STYLE AUDIO PROCESSING: Use global audio data instead of internal processing
                // This eliminates conflicts with holographic system and ensures consistent audio reactivity
                // Audio reactivity now handled directly in visualizer render loops
                
                // CRITICAL FIX: Update visualizer parameters before rendering
                const currentParams = this.parameters.getAllParameters();
                
                this.visualizers.forEach(visualizer => {
                    if (visualizer.updateParameters && visualizer.render) {
                        visualizer.updateParameters(currentParams);
                        visualizer.render();
                    }
                });
                
                // Mobile debug: Log render activity periodically
                if (window.mobileDebug && !this._renderActivityLogged) {
                    window.mobileDebug.log(`🎬 Quantum Engine: Actively rendering ${this.visualizers?.length} visualizers`);
                    this._renderActivityLogged = true;
                }
            } else if (window.mobileDebug && !this._inactiveWarningLogged) {
                window.mobileDebug.log(`⚠️ Quantum Engine: Not rendering because isActive=false`);
                this._inactiveWarningLogged = true;
            }
            
            requestAnimationFrame(render);
        };
        
        render();
        console.log('🎬 Quantum render loop started');
        
        if (window.mobileDebug) {
            window.mobileDebug.log(`✅ Quantum Engine: Render loop started, will render when isActive=true`);
        }
    }
    
    /**
     * Update audio reactivity (for universal reactivity system)
     */
    // Audio reactivity now handled directly in visualizer render loops
    
    /**
     * Update click effects (for universal reactivity system)
     */
    updateClick(intensity) {
        this.visualizers.forEach(visualizer => {
            if (visualizer.triggerClick) {
                visualizer.triggerClick(0.5, 0.5, intensity); // Click at center with intensity
            }
        });
    }
    
    /**
     * Update scroll effects (for universal reactivity system)
     */
    updateScroll(velocity) {
        this.visualizers.forEach(visualizer => {
            if (visualizer.updateScroll) {
                visualizer.updateScroll(velocity);
            }
        });
    }
    
    /**
     * Clean up resources
     */
    destroy() {
        if (this.canvasLifecycleCleanup) {
            this.canvasLifecycleCleanup();
            this.canvasLifecycleCleanup = null;
        }
        // Disconnect from universal reactivity
        if (window.universalReactivity) {
            window.universalReactivity.disconnectSystem('quantum');
        }

        this.visualizers.forEach(visualizer => {
            if (visualizer.destroy) {
                visualizer.destroy();
            }
        });
        this.visualizers = [];
        console.log('🧹 Quantum Engine destroyed');
    }
}