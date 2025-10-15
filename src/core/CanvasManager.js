/**
 * Dead Simple Canvas Manager - Just hide/show containers + fresh engines
 * No canvas destruction - HTML canvases stay put, just switch visibility
 */

export class CanvasManager {
  constructor() {
    this.currentSystem = null;
    this.currentEngine = null;
    this.boundResizeHandler = null;
    this.resizeEventOptions = { passive: true };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.boundResizeHandler = this.handleResize.bind(this);
      window.addEventListener('resize', this.boundResizeHandler, this.resizeEventOptions);

      try {
        window.addEventListener('orientationchange', this.boundResizeHandler, this.resizeEventOptions);
      } catch (error) {
        console.warn('⚠️ Failed to attach orientationchange listener', error);
      }
    }
  }

  async switchToSystem(systemName, engineClasses) {
    console.log(`🔄 DESTROY OLD → CREATE NEW: ${systemName}`);

    const previousSystem = this.currentSystem;
    if (previousSystem) {
      this.dispatchSystemEvent('vib34d:system-deactivated', {
        systemName: previousSystem,
        systems: [previousSystem]
      });
    }

    // STEP 1: DESTROY current engine completely
    if (this.currentEngine) {
      if (this.currentEngine.setActive) {
        this.currentEngine.setActive(false);
      }
      if (this.currentEngine.destroy) {
        this.currentEngine.destroy();
      }
      console.log('💥 Old engine destroyed');
    }

    this.currentEngine = null;
    this.currentSystem = null;

    // STEP 2: DESTROY old WebGL contexts
    this.destroyOldWebGLContexts();

    // STEP 3: DESTROY all canvases + CREATE 5 fresh ones
    this.destroyAllCanvasesAndCreateFresh(systemName);
    
    // STEP 4: CREATE fresh engine
    const engine = await this.createFreshEngine(systemName, engineClasses);
    
    // STEP 5: Start new engine
    if (engine && engine.setActive) {
      engine.setActive(true);
    }

    this.currentSystem = systemName;
    this.currentEngine = engine;

    this.handleResize();
    console.log(`✅ DESTROY → CREATE complete: ${systemName} ready`);

    this.dispatchSystemEvent('vib34d:system-activated', {
      systemName,
      systems: [systemName],
      engineReady: !!engine
    });

    return engine;
  }

  dispatchSystemEvent(eventName, detail = {}) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
      return;
    }

    try {
      let event;
      if (typeof window.CustomEvent === 'function') {
        event = new window.CustomEvent(eventName, { detail });
      } else if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
        event = document.createEvent('CustomEvent');
        event.initCustomEvent(eventName, false, false, detail);
      } else {
        return;
      }
      window.dispatchEvent(event);
    } catch (error) {
      console.warn('⚠️ Failed to dispatch system event', eventName, error);
    }
  }

  destroyOldWebGLContexts() {
    console.log('💥 COMPLETE DESTRUCTION: WebGL contexts + old system cleanup...');
    
    // STEP 1: Kill all WebGL contexts first
    const allCanvases = document.querySelectorAll('canvas');
    let destroyedCount = 0;
    
    allCanvases.forEach(canvas => {
      // Get any existing WebGL context
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        // Force context loss
        const loseContextExt = gl.getExtension('WEBGL_lose_context');
        if (loseContextExt) {
          loseContextExt.loseContext();
          destroyedCount++;
        }
      }
    });
    
    // STEP 2: Clear all global engine references (old system cleanup)
    if (window.engine) {
      console.log('💥 Clearing window.engine');
      window.engine = null;
    }
    if (window.quantumEngine) {
      console.log('💥 Clearing window.quantumEngine');
      window.quantumEngine = null;
    }
    if (window.holographicSystem) {
      console.log('💥 Clearing window.holographicSystem');
      window.holographicSystem = null;
    }
    if (window.polychoraSystem) {
      console.log('💥 Clearing window.polychoraSystem');
      window.polychoraSystem = null;
    }
    
    console.log(`💥 DESTRUCTION COMPLETE: ${destroyedCount} WebGL contexts destroyed, all engine refs cleared`);
  }

  destroyAllCanvasesAndCreateFresh(systemName) {
    console.log('💥 DESTROYING ALL CANVASES + CREATING 5 FRESH ONES');
    
    // STEP 1: DESTROY all existing canvases completely
    const allCanvases = document.querySelectorAll('canvas');
    allCanvases.forEach(canvas => canvas.remove());
    console.log(`💥 Destroyed ${allCanvases.length} old canvases`);
    
    // STEP 2: Clear all containers
    const containers = ['vib34dLayers', 'quantumLayers', 'holographicLayers', 'polychoraLayers'];
    containers.forEach(containerId => {
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '';
        container.style.display = 'none';
      }
    });
    
    // STEP 3: CREATE 5 fresh canvases for the new system
    const targetId = systemName === 'faceted' ? 'vib34dLayers' : `${systemName}Layers`;
    const targetContainer = document.getElementById(targetId);
    
    if (!targetContainer) {
      console.error(`❌ Container ${targetId} not found`);
      return;
    }
    
    // Create canvas IDs for this system
    const canvasIds = this.getCanvasIdsForSystem(systemName);
    
    // Create 5 fresh canvases
    canvasIds.forEach((canvasId, index) => {
      const canvas = document.createElement('canvas');
      canvas.id = canvasId;
      canvas.className = 'visualization-canvas';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.zIndex = index + 1;
      
      // Set canvas dimensions
      const viewWidth = window.innerWidth;
      const viewHeight = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = viewWidth * dpr;
      canvas.height = viewHeight * dpr;
      
      targetContainer.appendChild(canvas);
    });
    
    // Show the target container
    targetContainer.style.display = 'block';
    targetContainer.style.visibility = 'visible';
    targetContainer.style.opacity = '1';
    
    console.log(`✅ Created 5 fresh canvases for ${systemName}: ${canvasIds.join(', ')}`);
  }
  
  getCanvasIdsForSystem(systemName) {
    const baseIds = ['background-canvas', 'shadow-canvas', 'content-canvas', 'highlight-canvas', 'accent-canvas'];

    switch (systemName) {
      case 'faceted':
        return baseIds;
      case 'quantum':
        return baseIds.map(id => `quantum-${id}`);
      case 'holographic':
        return baseIds.map(id => `holo-${id}`);
      case 'polychora':
        return baseIds.map(id => `polychora-${id}`);
      default:
        return baseIds;
    }
  }

  getActiveContainer() {
    if (typeof document === 'undefined') {
      return null;
    }

    const targetId = this.currentSystem === 'faceted' ? 'vib34dLayers' : `${this.currentSystem}Layers`;
    return document.getElementById(targetId) || null;
  }

  getViewportDimensions() {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0 };
    }

    return {
      width: Math.max(0, Math.floor(window.innerWidth || 0)),
      height: Math.max(0, Math.floor(window.innerHeight || 0))
    };
  }

  handleResize() {
    if (!this.currentSystem || typeof window === 'undefined') {
      return;
    }

    const container = this.getActiveContainer();
    const viewport = this.getViewportDimensions();
    const width = Math.max(1, Math.floor(container?.clientWidth || viewport.width || 1));
    const height = Math.max(1, Math.floor(container?.clientHeight || viewport.height || 1));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const canvasIds = this.getCanvasIdsForSystem(this.currentSystem);

    canvasIds.forEach(canvasId => {
      const canvas = typeof document !== 'undefined' ? document.getElementById(canvasId) : null;
      if (!canvas) {
        return;
      }

      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));

      if (canvas.width !== pixelWidth) {
        canvas.width = pixelWidth;
      }
      if (canvas.height !== pixelHeight) {
        canvas.height = pixelHeight;
      }

      if (canvas.style) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    });

    if (this.currentEngine && typeof this.currentEngine.resize === 'function') {
      try {
        this.currentEngine.resize({ width, height, dpr });
      } catch (error) {
        console.warn('⚠️ Active engine resize handler failed', error);
      }
    }
  }

  destroy() {
    if (this.boundResizeHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this.boundResizeHandler, this.resizeEventOptions);

      try {
        window.removeEventListener('orientationchange', this.boundResizeHandler, this.resizeEventOptions);
      } catch (error) {
        // Ignore orientation removal failures
      }
    }
  }

  async createFreshEngine(systemName, engineClasses) {
    console.log(`🚀 Creating fresh ${systemName} engine`);
    
    let engine = null;
    
    try {
      switch(systemName) {
        case 'faceted':
          if (engineClasses.VIB34DIntegratedEngine) {
            engine = new engineClasses.VIB34DIntegratedEngine();
            window.engine = engine;
            console.log('✅ Fresh Faceted engine');
          }
          break;
          
        case 'quantum':
          if (engineClasses.QuantumEngine) {
            engine = new engineClasses.QuantumEngine();
            window.quantumEngine = engine;
            console.log('✅ Fresh Quantum engine');
          }
          break;
          
        case 'holographic':
          if (engineClasses.RealHolographicSystem) {
            engine = new engineClasses.RealHolographicSystem();
            window.holographicSystem = engine;
            console.log('✅ Fresh Holographic engine');
          }
          break;
          
        case 'polychora':
          if (engineClasses.NewPolychoraEngine) {
            engine = new engineClasses.NewPolychoraEngine();
            window.newPolychoraEngine = engine;
            console.log('✅ Fresh TRUE 4D Polychora Engine with VIB34D DNA');
          }
          break;
          
        default:
          console.error(`❌ Unknown system: ${systemName}`);
      }
      
    } catch (error) {
      console.error(`💥 Engine creation failed for ${systemName}:`, error);
      engine = null;
    }
    
    return engine;
  }
}