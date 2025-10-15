/**
 * VIB34D Integrated Holographic Visualizer
 * WebGL-based renderer for individual holographic layers
 */

import { GeometryManager, ProjectionManager, ShaderManager } from './shaders/DynamicShaderModules.js';

export class IntegratedHolographicVisualizer {
    constructor(canvasId, role, reactivity, variant) {
        this.canvas = document.getElementById(canvasId);
        this.role = role;
        this.reactivity = reactivity;
        this.variant = variant;
        
        if (!this.canvas) {
            console.error(`Canvas ${canvasId} not found`);
            return;
        }
        let rect = this.canvas.getBoundingClientRect();
        const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance
        
        // Store context options for later use
        this.contextOptions = {
            alpha: true,
            depth: true,
            stencil: false,
            antialias: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false
        };
        
        // CRITICAL FIX: Ensure canvas is properly sized BEFORE creating WebGL context
        this.ensureCanvasSizedThenInitWebGL(rect, devicePixelRatio);
        
        this.mouseX = 0.5;
        this.mouseY = 0.5;
        this.mouseIntensity = 0.0;
        this.clickIntensity = 0.0;
        this.startTime = Date.now();

        // Default parameters
        this.params = {
            geometry: 0,
            geometryType: 'hypercube',
            projectionMethod: 'perspective',
            shaderProgramName: 'maleficarumViz',
            gridDensity: 15,
            morphFactor: 1.0,
            chaos: 0.2,
            speed: 1.0,
            rotationSpeed: 0.2,
            hue: 200,
            intensity: 0.5,
            saturation: 0.8,
            dimension: 3.5,
            rot4dXW: 0.0,
            rot4dYW: 0.0,
            rot4dZW: 0.0,
            universeModifier: 1.0,
            patternIntensity: 1.0,
            lineThickness: 0.03,
            shellWidth: 0.025,
            tetraThickness: 0.035,
            glitchIntensity: 0.0,
            colorShift: 0.0,
            primaryColor: [1.0, 0.2, 0.8],
            secondaryColor: [0.2, 1.0, 1.0],
            backgroundColor: [0.05, 0.0, 0.2],
            audioBass: 0.0,
            audioMid: 0.0,
            audioHigh: 0.0
        };

        this.geometryManager = null;
        this.projectionManager = null;
        this.shaderManager = null;
        this.attributeLocations = {};
        
        // Initialization now happens in ensureCanvasSizedThenInitWebGL after sizing
        // this.init(); // MOVED
    }
    
    /**
     * CRITICAL FIX: Ensure canvas is properly sized before creating WebGL context
     */
    async ensureCanvasSizedThenInitWebGL(rect, devicePixelRatio) {
        // If canvas has no dimensions, wait for layout or use viewport
        if (rect.width === 0 || rect.height === 0) {
            // Wait for layout with promise
            await new Promise(resolve => {
                setTimeout(() => {
                    rect = this.canvas.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) {
                        // Use viewport dimensions as fallback
                        const viewWidth = window.innerWidth;
                        const viewHeight = window.innerHeight;
                        this.canvas.width = viewWidth * devicePixelRatio;
                        this.canvas.height = viewHeight * devicePixelRatio;
                        
                        if (window.mobileDebug) {
                            window.mobileDebug.log(`📐 Canvas ${this.canvas.id}: Using viewport fallback ${this.canvas.width}x${this.canvas.height}`);
                        }
                    } else {
                        this.canvas.width = rect.width * devicePixelRatio;
                        this.canvas.height = rect.height * devicePixelRatio;
                        
                        if (window.mobileDebug) {
                            window.mobileDebug.log(`📐 Canvas ${this.canvas.id}: Layout ready ${this.canvas.width}x${this.canvas.height}`);
                        }
                    }
                    resolve();
                }, 100);
            });
        } else {
            this.canvas.width = rect.width * devicePixelRatio;
            this.canvas.height = rect.height * devicePixelRatio;
            
            if (window.mobileDebug) {
                window.mobileDebug.log(`📐 Canvas ${this.canvas.id}: ${this.canvas.width}x${this.canvas.height} (DPR: ${devicePixelRatio})`);
            }
        }
        
        // NOW create WebGL context with properly sized canvas
        this.createWebGLContext();
        
        // Initialize rendering pipeline
        if (this.gl) {
            this.init();
        }
    }
    
    /**
     * Create WebGL context after canvas is properly sized
     */
    createWebGLContext() {
        // CRITICAL FIX: Check if context already exists from CanvasManager
        let existingContext = this.canvas.getContext('webgl2') || 
                             this.canvas.getContext('webgl') || 
                             this.canvas.getContext('experimental-webgl');
        
        if (existingContext && !existingContext.isContextLost()) {
            console.log(`🔄 Reusing existing WebGL context for ${this.canvas.id}`);
            this.gl = existingContext;
            return;
        }
        
        // Try WebGL2 first (better mobile support), then WebGL1
        this.gl = this.canvas.getContext('webgl2', this.contextOptions) || 
                  this.canvas.getContext('webgl', this.contextOptions) ||
                  this.canvas.getContext('experimental-webgl', this.contextOptions);
        
        if (!this.gl) {
            console.error(`WebGL not supported for ${this.canvas.id}`);
            if (window.mobileDebug) {
                window.mobileDebug.log(`❌ WebGL context failed for ${this.canvas.id} (size: ${this.canvas.width}x${this.canvas.height})`);
            }
            // Show user-friendly error instead of white screen
            this.showWebGLError();
            return;
        } else {
            if (window.mobileDebug) {
                const version = this.gl.getParameter(this.gl.VERSION);
                window.mobileDebug.log(`✅ WebGL context created for ${this.canvas.id}: ${version} (size: ${this.canvas.width}x${this.canvas.height})`);
            }
        }
    }

    /**
     * Initialize WebGL rendering pipeline
     */
    init() {
        if (!this.geometryManager) {
            this.geometryManager = new GeometryManager();
        }
        if (!this.projectionManager) {
            this.projectionManager = new ProjectionManager();
        }
        if (!this.shaderManager && this.gl) {
            this.shaderManager = new ShaderManager(this.gl, this.geometryManager, this.projectionManager);
        }

        this.initShaders();
        this.initBuffers();
        this.resize();
    }
    
    /**
     * Initialize shaders with 4D mathematics
     */
    initShaders() {
        this.rebuildShaderProgram();
    }

    rebuildShaderProgram() {
        if (!this.shaderManager) {
            return;
        }

        const programName = this.params.shaderProgramName || 'maleficarumViz';
        const geometryType = this.params.geometryType || 'hypercube';
        const projectionMethod = this.params.projectionMethod || 'perspective';

        const program = this.shaderManager.createDynamicProgram(programName, geometryType, projectionMethod);
        if (!program) {
            console.error('Failed to compile dynamic shader program');
            return;
        }

        this.program = program;
        this.shaderManager.useProgram(programName);

        const uniformMap = {
            resolution: 'u_resolution',
            time: 'u_time',
            dimension: 'u_dimension',
            morphFactor: 'u_morphFactor',
            rotationSpeed: 'u_rotationSpeed',
            universeModifier: 'u_universeModifier',
            patternIntensity: 'u_patternIntensity',
            gridDensity: 'u_gridDensity',
            lineThickness: 'u_lineThickness',
            shellWidth: 'u_shellWidth',
            tetraThickness: 'u_tetraThickness',
            audioBass: 'u_audioBass',
            audioMid: 'u_audioMid',
            audioHigh: 'u_audioHigh',
            glitchIntensity: 'u_glitchIntensity',
            colorShift: 'u_colorShift',
            primaryColor: 'u_primaryColor',
            secondaryColor: 'u_secondaryColor',
            backgroundColor: 'u_backgroundColor'
        };

        this.uniforms = {};
        Object.entries(uniformMap).forEach(([key, uniformName]) => {
            this.uniforms[key] = this.shaderManager.getUniformLocation(uniformName);
        });

        this.attributeLocations.position = this.shaderManager.getAttributeLocation('a_position');

        if (this.buffer) {
            this.initBuffers();
        }
    }
    
    /**
     * Create WebGL program from shaders
     */
    createProgram(vertexSource, fragmentSource) {
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        
        if (!vertexShader || !fragmentShader) {
            return null;
        }
        
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking failed:', this.gl.getProgramInfoLog(program));
            return null;
        }
        
        return program;
    }
    
    /**
     * Create individual shader
     */
    createShader(type, source) {
        // CRITICAL FIX: Check WebGL context state before shader operations
        if (!this.gl) {
            console.error('❌ Cannot create shader: WebGL context is null');
            return null;
        }
        
        if (this.gl.isContextLost()) {
            console.error('❌ Cannot create shader: WebGL context is lost');
            return null;
        }
        
        try {
            const shader = this.gl.createShader(type);
            
            if (!shader) {
                console.error('❌ Failed to create shader object - WebGL context may be invalid');
                return null;
            }
            
            this.gl.shaderSource(shader, source);
            this.gl.compileShader(shader);
            
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                const error = this.gl.getShaderInfoLog(shader);
                const shaderType = type === this.gl.VERTEX_SHADER ? 'vertex' : 'fragment';
                
                // CRITICAL FIX: Show actual error instead of null
                if (error) {
                    console.error(`❌ ${shaderType} shader compilation failed:`, error);
                } else {
                    console.error(`❌ ${shaderType} shader compilation failed: WebGL returned no error info (context may be invalid)`);
                }
                
                console.error('Shader source:', source);
                this.gl.deleteShader(shader);
                return null;
            }
            
            return shader;
        } catch (error) {
            console.error('❌ Exception during shader creation:', error);
            return null;
        }
    }
    
    /**
     * Initialize vertex buffers
     */
    initBuffers() {
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

        if (!this.buffer) {
            this.buffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        } else {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
        }

        const positionLocation = this.attributeLocations.position ?? this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);
    }
    
    /**
     * Resize canvas and viewport
     */
    resize() {
        // Mobile-optimized canvas sizing
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for mobile performance
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        
        // Only resize if dimensions actually changed (mobile optimization)
        if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
            this.canvas.width = width * dpr;
            this.canvas.height = height * dpr;
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    /**
     * Show user-friendly WebGL error message
     */
    showWebGLError() {
        if (!this.canvas) return;
        
        // Try 2D canvas fallback
        const ctx = this.canvas.getContext('2d');
        if (ctx) {
            this.canvas.width = this.canvas.clientWidth;
            this.canvas.height = this.canvas.clientHeight;
            
            ctx.fillStyle = '#1a0033';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Mobile-friendly error display
            ctx.fillStyle = '#ff6b6b';
            ctx.font = `${Math.min(20, this.canvas.width / 15)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('⚠️ WebGL Error', this.canvas.width / 2, this.canvas.height / 2 - 30);
            
            ctx.fillStyle = '#ffd93d';
            ctx.font = `${Math.min(14, this.canvas.width / 20)}px sans-serif`;
            
            const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (isMobile) {
                ctx.fillText('Mobile device detected', this.canvas.width / 2, this.canvas.height / 2);
                ctx.fillText('Enable hardware acceleration', this.canvas.width / 2, this.canvas.height / 2 + 20);
                ctx.fillText('or try Chrome/Firefox', this.canvas.width / 2, this.canvas.height / 2 + 40);
            } else {
                ctx.fillText('Please enable WebGL', this.canvas.width / 2, this.canvas.height / 2);
                ctx.fillText('in your browser settings', this.canvas.width / 2, this.canvas.height / 2 + 20);
            }
            
            // Log to mobile debug
            if (window.mobileDebug) {
                window.mobileDebug.log(`📱 WebGL error fallback shown for canvas ${this.canvas.id}`);
            }
        } else {
            // Even 2D canvas failed - create HTML fallback
            const errorDiv = document.createElement('div');
            errorDiv.innerHTML = `
                <div style="
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: #1a0033;
                    color: #ff6b6b;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    font-family: sans-serif;
                    text-align: center;
                    padding: 20px;
                ">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-size: 18px; margin-bottom: 10px;">Graphics Error</div>
                    <div style="font-size: 14px; color: #ffd93d;">
                        Your device doesn't support<br>
                        the required graphics features
                    </div>
                </div>
            `;
            this.canvas.parentNode.insertBefore(errorDiv, this.canvas.nextSibling);
        }
    }

    /**
     * Map legacy geometry indices to dynamic shader geometry identifiers.
     */
    mapGeometryIndexToType(index) {
        const mapping = {
            0: 'hypertetrahedron',
            1: 'hypercube',
            2: 'hypersphere'
        };
        return mapping[index] || this.params.geometryType || 'hypercube';
    }

    /**
     * Update visualization parameters
     */
    updateParameters(params) {
        const derivedParams = { ...params };

        if (typeof params.geometry === 'number' && params.geometryType === undefined) {
            derivedParams.geometryType = this.mapGeometryIndexToType(params.geometry);
        }

        const prevGeometryType = this.params.geometryType;
        const prevProjection = this.params.projectionMethod;
        const prevProgram = this.params.shaderProgramName;

        this.params = { ...this.params, ...derivedParams };

        const needsRebuild = (
            this.params.geometryType !== prevGeometryType ||
            this.params.projectionMethod !== prevProjection ||
            this.params.shaderProgramName !== prevProgram
        );

        if (needsRebuild && this.gl) {
            this.rebuildShaderProgram();
        }
    }

    setUniform1f(key, value) {
        const location = this.uniforms?.[key];
        if (location) {
            this.gl.uniform1f(location, value);
        }
    }

    setUniform2f(key, v0, v1) {
        const location = this.uniforms?.[key];
        if (location) {
            this.gl.uniform2f(location, v0, v1);
        }
    }

    setUniform3f(key, v0, v1, v2) {
        const location = this.uniforms?.[key];
        if (location) {
            this.gl.uniform3f(location, v0, v1, v2);
        }
    }
    
    /**
     * Update mouse interaction state
     */
    updateInteraction(x, y, intensity) {
        // Check if interactions are enabled globally
        if (window.interactivityEnabled === false) {
            // Reset to default when disabled
            this.mouseX = 0.5;
            this.mouseY = 0.5;
            this.mouseIntensity = 0.0;
            return;
        }
        
        this.mouseX = x;
        this.mouseY = y;
        this.mouseIntensity = intensity;
    }
    
    /**
     * Render frame
     */
    render() {
        if (!this.program) {
            if (window.mobileDebug) {
                window.mobileDebug.log(`❌ ${this.canvas?.id}: No WebGL program compiled`);
            }
            return;
        }
        
        if (!this.gl) {
            if (window.mobileDebug) {
                window.mobileDebug.log(`❌ ${this.canvas?.id}: No WebGL context`);
            }
            return;
        }
        
        try {
            this.resize();
            this.gl.useProgram(this.program);
            
            // CRITICAL FIX: Clear framebuffer before rendering
            this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        } catch (error) {
            if (window.mobileDebug) {
                window.mobileDebug.log(`❌ ${this.canvas?.id}: WebGL render error: ${error.message}`);
            }
            return;
        }
        
        const timeSeconds = (Date.now() - this.startTime) / 1000;

        // Set uniforms for the dynamic shader
        this.setUniform2f('resolution', this.canvas.width, this.canvas.height);
        this.setUniform1f('time', timeSeconds);

        const audioReactive = (window.audioEnabled && window.audioReactive) ? window.audioReactive : null;
        const audioBass = audioReactive?.bass ?? this.params.audioBass ?? 0;
        const audioMid = audioReactive?.mid ?? this.params.audioMid ?? 0;
        const audioHigh = audioReactive?.high ?? this.params.audioHigh ?? 0;

        const gridDensityBase = this.params.gridDensity;
        const gridDensity = Math.max(0.1, gridDensityBase * (1.0 + audioBass * 0.4));
        const morphFactor = this.params.morphFactor;
        const rotationSpeed = (this.params.rotationSpeed ?? this.params.speed ?? 0.2) * (1.0 + audioHigh * 0.15);
        const universeModifier = this.params.universeModifier;
        const patternIntensity = this.params.patternIntensity * (1.0 + audioMid * 0.2);

        this.setUniform1f('gridDensity', gridDensity);
        this.setUniform1f('morphFactor', morphFactor);
        this.setUniform1f('rotationSpeed', rotationSpeed);
        this.setUniform1f('universeModifier', universeModifier);
        this.setUniform1f('patternIntensity', patternIntensity);
        this.setUniform1f('dimension', this.params.dimension);
        this.setUniform1f('lineThickness', this.params.lineThickness);
        this.setUniform1f('shellWidth', this.params.shellWidth);
        this.setUniform1f('tetraThickness', this.params.tetraThickness);
        this.setUniform1f('audioBass', audioBass);
        this.setUniform1f('audioMid', audioMid);
        this.setUniform1f('audioHigh', audioHigh);
        this.setUniform1f('glitchIntensity', this.params.glitchIntensity);
        this.setUniform1f('colorShift', this.params.colorShift);

        const primary = this.params.primaryColor || [1.0, 0.2, 0.8];
        const secondary = this.params.secondaryColor || [0.2, 1.0, 1.0];
        const background = this.params.backgroundColor || [0.05, 0.0, 0.2];

        this.setUniform3f('primaryColor', primary[0], primary[1], primary[2]);
        this.setUniform3f('secondaryColor', secondary[0], secondary[1], secondary[2]);
        this.setUniform3f('backgroundColor', background[0], background[1], background[2]);

        this.params.audioBass = audioBass;
        this.params.audioMid = audioMid;
        this.params.audioHigh = audioHigh;

        try {
            this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
            
            // Mobile success logging (only once per canvas)
            if (window.mobileDebug && !this._renderSuccessLogged) {
                window.mobileDebug.log(`✅ ${this.canvas?.id}: WebGL render successful`);
                this._renderSuccessLogged = true;
            }
        } catch (error) {
            if (window.mobileDebug) {
                window.mobileDebug.log(`❌ ${this.canvas?.id}: WebGL draw error: ${error.message}`);
            }
        }
    }
    
    /**
     * CRITICAL FIX: Reinitialize WebGL program after context recreation
     */
    reinitializeContext() {
        console.log(`🔄 Reinitializing WebGL context for ${this.canvas?.id}`);
        
        // Clear ALL old WebGL references
        this.program = null;
        this.buffer = null;
        this.uniforms = null;
        this.shaderManager = null;
        this.geometryManager = null;
        this.projectionManager = null;
        this.attributeLocations = {};
        this.gl = null;
        
        // CRITICAL FIX: Don't create new context - CanvasManager already did this
        // Just get the existing context that CanvasManager created
        this.gl = this.canvas.getContext('webgl2') || 
                  this.canvas.getContext('webgl') ||
                  this.canvas.getContext('experimental-webgl');
        
        if (!this.gl) {
            console.error(`❌ No WebGL context available for ${this.canvas?.id} - CanvasManager should have created one`);
            return false;
        }
        
        if (this.gl.isContextLost()) {
            console.error(`❌ WebGL context is lost for ${this.canvas?.id}`);
            return false;
        }
        
        // Reinitialize shaders and buffers if context is valid
        try {
            this.init();
            console.log(`✅ ${this.canvas?.id}: Context reinitialized successfully`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to reinitialize WebGL resources for ${this.canvas?.id}:`, error);
            return false;
        }
    }

    // Audio reactivity now handled directly in render() loop - no complex methods needed
    
    /**
     * Clean up WebGL resources
     */
    destroy() {
        if (this.gl && this.program) {
            this.gl.deleteProgram(this.program);
        }
        if (this.gl && this.buffer) {
            this.gl.deleteBuffer(this.buffer);
        }
    }
}