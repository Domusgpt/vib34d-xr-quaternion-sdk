import { GeometryLibrary } from '../geometry/GeometryLibrary.js';

export const ROTATION_PLANE_KEYS = Object.freeze([
    'rot4dXY',
    'rot4dXZ',
    'rot4dYZ',
    'rot4dXW',
    'rot4dYW',
    'rot4dZW'
]);

/**
 * VIB34D Parameter Management System
 * Unified parameter control for both holographic and polytopal systems
 */

export class ParameterManager {
    constructor() {
        // Default parameter set combining both systems
        this.params = {
            // Current variation
            variation: 0,

            // 4D Polytopal Mathematics
            rot4dXY: 0.0,      // X-Y plane rotation
            rot4dXZ: 0.0,      // X-Z plane rotation
            rot4dYZ: 0.0,      // Y-Z plane rotation
            rot4dXW: 0.0,      // X-W plane rotation (-2 to 2)
            rot4dYW: 0.0,      // Y-W plane rotation (-2 to 2)
            rot4dZW: 0.0,      // Z-W plane rotation (-2 to 2)
            dimension: 3.5,    // Dimensional level (3.0 to 4.5)
            
            // Holographic Visualization
            gridDensity: 15,   // Geometric detail (4 to 30)
            morphFactor: 1.0,  // Shape transformation (0 to 2)
            chaos: 0.2,        // Randomization level (0 to 1)
            speed: 1.0,        // Animation speed (0.1 to 3)
            hue: 200,          // Color rotation (0 to 360)
            intensity: 0.5,    // Visual intensity (0 to 1)
            saturation: 0.8,   // Color saturation (0 to 1)

            // Geometry selection
            geometry: 0,       // Current geometry type (0-23)
            geometryBase: 0,
            geometryCore: 0
        };

        // Parameter definitions for validation and UI
        this.parameterDefs = {
            variation: { min: 0, max: 99, step: 1, type: 'int' },
            rot4dXY: { min: -6.28, max: 6.28, step: 0.01, type: 'float' },
            rot4dXZ: { min: -6.28, max: 6.28, step: 0.01, type: 'float' },
            rot4dYZ: { min: -6.28, max: 6.28, step: 0.01, type: 'float' },
            rot4dXW: { min: -6.28, max: 6.28, step: 0.01, type: 'float' },
            rot4dYW: { min: -6.28, max: 6.28, step: 0.01, type: 'float' },
            rot4dZW: { min: -6.28, max: 6.28, step: 0.01, type: 'float' },
            dimension: { min: 3.0, max: 4.5, step: 0.01, type: 'float' },
            gridDensity: { min: 4, max: 100, step: 0.1, type: 'float' },
            morphFactor: { min: 0, max: 2, step: 0.01, type: 'float' },
            chaos: { min: 0, max: 1, step: 0.01, type: 'float' },
            speed: { min: 0.1, max: 3, step: 0.01, type: 'float' },
            hue: { min: 0, max: 360, step: 1, type: 'int' },
            intensity: { min: 0, max: 1, step: 0.01, type: 'float' },
            saturation: { min: 0, max: 1, step: 0.01, type: 'float' },
            geometry: { min: 0, max: GeometryLibrary.getGeometryNames().length - 1, step: 1, type: 'int' },
            geometryBase: { min: 0, max: GeometryLibrary.baseGeometries.length - 1, step: 1, type: 'int' },
            geometryCore: { min: 0, max: GeometryLibrary.coreVariants.length - 1, step: 1, type: 'int' }
        };

        this.syncDerivedGeometryFields();

        // Default parameter backup for reset
        this.defaults = { ...this.params };
        this._cachedRotationState = null;
    }
    
    /**
     * Get all current parameters
     */
    getAllParameters() {
        return { ...this.params };
    }
    
    /**
     * Set a specific parameter with validation
     */
    setParameter(name, value) {
        if (this.parameterDefs[name]) {
            const def = this.parameterDefs[name];

            // Clamp value to valid range
            value = Math.max(def.min, Math.min(def.max, value));

            // Apply type conversion
            if (def.type === 'int') {
                value = Math.round(value);
            }

            this.params[name] = value;
            if (ROTATION_PLANE_KEYS.includes(name)) {
                this._cachedRotationState = null;
            }
            return true;
        }
        
        console.warn(`Unknown parameter: ${name}`);
        return false;
    }

    /**
     * Set multiple parameters at once
     */
    setParameters(paramObj = {}) {
        if (paramObj === null || typeof paramObj !== 'object') {
            return;
        }

        const hasGeometry = Object.prototype.hasOwnProperty.call(paramObj, 'geometry');
        const hasRotationProfile = ROTATION_PLANE_KEYS.some(plane =>
            Object.prototype.hasOwnProperty.call(paramObj, plane)
        );

        if (hasGeometry) {
            this.setGeometry(paramObj.geometry);
        }

        for (const [name, value] of Object.entries(paramObj)) {
            if (name === 'geometry') {
                continue;
            }
            this.setParameter(name, value);
        }

        if (hasGeometry && (!Object.prototype.hasOwnProperty.call(paramObj, 'geometryBase')
            || !Object.prototype.hasOwnProperty.call(paramObj, 'geometryCore'))) {
            this.syncDerivedGeometryFields();
        }

        if (hasRotationProfile) {
            this._cachedRotationState = null;
        }
    }

    setRotationPlane(plane, value) {
        if (!ROTATION_PLANE_KEYS.includes(plane)) {
            throw new Error(`Unknown rotation plane "${plane}"`);
        }
        const result = this.setParameter(plane, value);
        this._cachedRotationState = null;
        return result;
    }

    getRotationParameters() {
        if (this._cachedRotationState) {
            return { ...this._cachedRotationState };
        }
        const rotationState = {};
        for (const plane of ROTATION_PLANE_KEYS) {
            rotationState[plane] = this.params[plane];
        }
        this._cachedRotationState = { ...rotationState };
        return rotationState;
    }

    applyRotationProfile(profile = {}) {
        if (!profile || typeof profile !== 'object') {
            return false;
        }

        const rotations = profile.rotations && typeof profile.rotations === 'object'
            ? profile.rotations
            : profile;

        let applied = false;
        for (const plane of ROTATION_PLANE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(rotations, plane)) {
                continue;
            }
            this.setRotationPlane(plane, rotations[plane]);
            applied = true;
        }
        return applied;
    }

    applyRotationDeltas(deltas = {}) {
        if (!deltas || typeof deltas !== 'object') {
            return false;
        }

        let applied = false;
        for (const plane of ROTATION_PLANE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(deltas, plane)) {
                continue;
            }
            const delta = Number(deltas[plane]);
            if (!Number.isFinite(delta)) {
                continue;
            }
            const current = this.params[plane] || 0;
            this.setRotationPlane(plane, current + delta);
            applied = true;
        }
        return applied;
    }
    
    /**
     * Get a specific parameter value
     */
    getParameter(name) {
        return this.params[name];
    }
    
    /**
     * Set geometry type with validation
     */
    setGeometry(geometryType) {
        if (!this.setParameter('geometry', geometryType)) {
            return;
        }
        this.syncDerivedGeometryFields();
    }

    syncDerivedGeometryFields() {
        const geometryIndex = this.params.geometry ?? 0;
        const description = GeometryLibrary.describeGeometry(geometryIndex);
        if (!description) {
            return;
        }

        this.setParameter('geometryBase', description.baseIndex);
        this.setParameter('geometryCore', description.coreIndex);
    }
    
    /**
     * Update parameters from UI controls
     */
    updateFromControls() {
        const controlIds = [
            'variationSlider', 'rot4dXY', 'rot4dXZ', 'rot4dYZ', 'rot4dXW', 'rot4dYW', 'rot4dZW', 'dimension',
            'gridDensity', 'morphFactor', 'chaos', 'speed', 'hue'
        ];
        
        controlIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const value = parseFloat(element.value);
                
                // Map slider IDs to parameter names
                let paramName = id;
                if (id === 'variationSlider') {
                    paramName = 'variation';
                }
                
                this.setParameter(paramName, value);
            }
        });
    }
    
    /**
     * Update UI display values from current parameters
     */
    updateDisplayValues() {
        // Update slider values
        this.updateSliderValue('variationSlider', this.params.variation);
        this.updateSliderValue('rot4dXY', this.params.rot4dXY);
        this.updateSliderValue('rot4dXZ', this.params.rot4dXZ);
        this.updateSliderValue('rot4dYZ', this.params.rot4dYZ);
        this.updateSliderValue('rot4dXW', this.params.rot4dXW);
        this.updateSliderValue('rot4dYW', this.params.rot4dYW);
        this.updateSliderValue('rot4dZW', this.params.rot4dZW);
        this.updateSliderValue('dimension', this.params.dimension);
        this.updateSliderValue('gridDensity', this.params.gridDensity);
        this.updateSliderValue('morphFactor', this.params.morphFactor);
        this.updateSliderValue('chaos', this.params.chaos);
        this.updateSliderValue('speed', this.params.speed);
        this.updateSliderValue('hue', this.params.hue);
        
        // Update display texts
        this.updateDisplayText('rot4dXYDisplay', this.params.rot4dXY.toFixed(2));
        this.updateDisplayText('rot4dXZDisplay', this.params.rot4dXZ.toFixed(2));
        this.updateDisplayText('rot4dYZDisplay', this.params.rot4dYZ.toFixed(2));
        this.updateDisplayText('rot4dXWDisplay', this.params.rot4dXW.toFixed(2));
        this.updateDisplayText('rot4dYWDisplay', this.params.rot4dYW.toFixed(2));
        this.updateDisplayText('rot4dZWDisplay', this.params.rot4dZW.toFixed(2));
        this.updateDisplayText('dimensionDisplay', this.params.dimension.toFixed(2));
        this.updateDisplayText('gridDensityDisplay', this.params.gridDensity.toFixed(1));
        this.updateDisplayText('morphFactorDisplay', this.params.morphFactor.toFixed(2));
        this.updateDisplayText('chaosDisplay', this.params.chaos.toFixed(2));
        this.updateDisplayText('speedDisplay', this.params.speed.toFixed(2));
        this.updateDisplayText('hueDisplay', this.params.hue + '°');
        
        // Update variation info
        this.updateVariationInfo();

        // Update geometry preset buttons
        this.updateGeometryButtons();
    }
    
    updateSliderValue(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.value = value;
        }
    }
    
    updateDisplayText(id, text) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = text;
        }
    }
    
    updateVariationInfo() {
        const variationDisplay = document.getElementById('currentVariationDisplay');
        if (variationDisplay) {
            const geometryIndex = Math.max(0, Math.floor(this.params.geometry));
            const description = GeometryLibrary.describeGeometry(geometryIndex);
            const baseLabel = description?.baseName || 'CUSTOM VARIATION';
            const coreLabel = description && description.coreIndex > 0
                ? ` • ${description.coreName}`
                : '';

            variationDisplay.textContent = `${this.params.variation + 1} - ${baseLabel}${coreLabel}`;

            if (this.params.variation < 30) {
                const geometryLevel = (this.params.variation % 4) + 1;
                variationDisplay.textContent += ` ${geometryLevel}`;
            }
        }
    }
    
    updateGeometryButtons() {
        document.querySelectorAll('[data-geometry]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.geometry) === this.params.geometry);
        });
    }
    
    /**
     * Randomize all parameters
     */
    randomizeAll() {
        this.params.rot4dXY = Math.random() * 4 - 2;
        this.params.rot4dXZ = Math.random() * 4 - 2;
        this.params.rot4dYZ = Math.random() * 4 - 2;
        this.params.rot4dXW = Math.random() * 4 - 2;
        this.params.rot4dYW = Math.random() * 4 - 2;
        this.params.rot4dZW = Math.random() * 4 - 2;
        this.params.dimension = 3.0 + Math.random() * 1.5;
        this.params.gridDensity = 4 + Math.random() * 26;
        this.params.morphFactor = Math.random() * 2;
        this.params.chaos = Math.random();
        this.params.speed = 0.1 + Math.random() * 2.9;
        this.params.hue = Math.random() * 360;
        this.setGeometry(Math.floor(Math.random() * GeometryLibrary.getGeometryNames().length));
        this._cachedRotationState = null;
    }
    
    /**
     * Reset to default parameters
     */
    resetToDefaults() {
        this.params = { ...this.defaults };
        this.syncDerivedGeometryFields();
        this._cachedRotationState = null;
    }
    
    /**
     * Load parameter configuration
     */
    loadConfiguration(config) {
        if (config && typeof config === 'object') {
            // Validate and apply configuration
            for (const [key, value] of Object.entries(config)) {
                if (this.parameterDefs[key]) {
                    this.setParameter(key, value);
                }
            }
            return true;
        }
        return false;
    }
    
    /**
     * Export current configuration
     */
    exportConfiguration() {
        return {
            type: 'vib34d-integrated-config',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            name: `VIB34D Config ${new Date().toLocaleDateString()}`,
            parameters: { ...this.params }
        };
    }
    
    /**
     * Generate variation-specific parameters
     */
    generateVariationParameters(variationIndex) {
        if (variationIndex < 30) {
            // Default variations with consistent patterns
            const geometryType = Math.floor(variationIndex / 4);
            const level = variationIndex % 4;
            
            return {
                geometry: geometryType,
                gridDensity: 8 + (level * 4),
                morphFactor: 0.5 + (level * 0.3),
                chaos: level * 0.15,
                speed: 0.8 + (level * 0.2),
                hue: (geometryType * 45 + level * 15) % 360,
                rot4dXY: (level - 1.5) * 0.35,
                rot4dXZ: ((geometryType % 4) - 1.5) * 0.3,
                rot4dYZ: (((geometryType + level) % 4) - 1.5) * 0.25,
                rot4dXW: (level - 1.5) * 0.5,
                rot4dYW: (geometryType % 2) * 0.3,
                rot4dZW: ((geometryType + level) % 3) * 0.2,
                dimension: 3.2 + (level * 0.2)
            };
        } else {
            // Custom variations - return current parameters
            return { ...this.params };
        }
    }
    
    /**
     * Apply variation to current parameters
     */
    applyVariation(variationIndex) {
        const variationParams = this.generateVariationParameters(variationIndex);
        this.setParameters(variationParams);
        this.params.variation = variationIndex;
    }
    
    /**
     * Get HSV color values for current hue
     */
    getColorHSV() {
        return {
            h: this.params.hue,
            s: 0.8, // Fixed saturation
            v: 0.9  // Fixed value
        };
    }
    
    /**
     * Get RGB color values for current hue
     */
    getColorRGB() {
        const hsv = this.getColorHSV();
        return this.hsvToRgb(hsv.h, hsv.s, hsv.v);
    }
    
    /**
     * Convert HSV to RGB
     */
    hsvToRgb(h, s, v) {
        h = h / 60;
        const c = v * s;
        const x = c * (1 - Math.abs((h % 2) - 1));
        const m = v - c;
        
        let r, g, b;
        if (h < 1) {
            [r, g, b] = [c, x, 0];
        } else if (h < 2) {
            [r, g, b] = [x, c, 0];
        } else if (h < 3) {
            [r, g, b] = [0, c, x];
        } else if (h < 4) {
            [r, g, b] = [0, x, c];
        } else if (h < 5) {
            [r, g, b] = [x, 0, c];
        } else {
            [r, g, b] = [c, 0, x];
        }
        
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
    }
    
    /**
     * Validate parameter configuration
     */
    validateConfiguration(config) {
        if (!config || typeof config !== 'object') {
            return { valid: false, error: 'Configuration must be an object' };
        }
        
        if (config.type !== 'vib34d-integrated-config') {
            return { valid: false, error: 'Invalid configuration type' };
        }
        
        if (!config.parameters) {
            return { valid: false, error: 'Missing parameters object' };
        }
        
        // Validate individual parameters
        for (const [key, value] of Object.entries(config.parameters)) {
            if (this.parameterDefs[key]) {
                const def = this.parameterDefs[key];
                if (typeof value !== 'number' || value < def.min || value > def.max) {
                    return { valid: false, error: `Invalid value for parameter ${key}: ${value}` };
                }
            }
        }
        
        return { valid: true };
    }
}