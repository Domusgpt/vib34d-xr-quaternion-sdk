/**
 * ExportSystem
 * Advanced export system for VIB34D data, configurations, and visualizations
 * Supports multiple formats including JSON, binary, and shader-specific exports
 */

export class ExportSystem {
  constructor(options = {}) {
    this.options = options;
    this.formats = new Map();

    // Initialize built-in export formats
    this.initializeBuiltInFormats();

    // Export history
    this.exportHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * Initialize built-in export formats
   */
  initializeBuiltInFormats() {
    // JSON format (prettified)
    this.registerFormat('json', (data) => {
      return JSON.stringify(data, null, 2);
    });

    // Compact JSON format
    this.registerFormat('json-compact', (data) => {
      return JSON.stringify(data);
    });

    // CSV format for numerical data
    this.registerFormat('csv', (data) => {
      return this.exportToCSV(data);
    });

    // Binary format for efficient storage
    this.registerFormat('binary', (data) => {
      return this.exportToBinary(data);
    });

    // Shader configuration format
    this.registerFormat('shader-config', (data) => {
      return this.exportShaderConfig(data);
    });

    // WebGL-compatible format
    this.registerFormat('webgl', (data) => {
      return this.exportWebGLFormat(data);
    });

    // Parameter preset format
    this.registerFormat('preset', (data) => {
      return this.exportPreset(data);
    });

    // Quaternion data format
    this.registerFormat('quaternion', (data) => {
      return this.exportQuaternionData(data);
    });

    // 4D geometry format
    this.registerFormat('geometry-4d', (data) => {
      return this.export4DGeometry(data);
    });

    // XR scene format
    this.registerFormat('xr-scene', (data) => {
      return this.exportXRScene(data);
    });
  }

  /**
   * Register an export format
   */
  registerFormat(name, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Export format handler must be a function');
    }
    this.formats.set(name, handler);
  }

  /**
   * Export data in specified format
   */
  async export(data, format = 'json', options = {}) {
    const handler = this.formats.get(format);

    if (!handler) {
      const error = new Error(`Export format "${format}" not supported. Available: ${this.getAvailableFormats().join(', ')}`);

      // Add failed export to history
      this.addToHistory({
        format,
        timestamp: Date.now(),
        error: error.message,
        success: false
      });

      throw error;
    }

    try {
      const result = await handler(data, options);

      // Add to export history
      this.addToHistory({
        format,
        timestamp: Date.now(),
        dataSize: this.estimateSize(result),
        success: true
      });

      return result;
    } catch (error) {
      // Add failed export to history
      this.addToHistory({
        format,
        timestamp: Date.now(),
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  /**
   * Export to CSV format
   */
  exportToCSV(data) {
    if (Array.isArray(data)) {
      if (data.length === 0) return '';

      // Extract headers from first object
      const headers = Object.keys(data[0]);
      const csvHeaders = headers.join(',');

      // Convert rows
      const csvRows = data.map(row => {
        return headers.map(header => {
          const value = row[header];
          // Escape quotes and wrap in quotes if contains comma
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',');
      });

      return [csvHeaders, ...csvRows].join('\n');
    }

    // For single objects, convert to two-row CSV
    const headers = Object.keys(data);
    const values = Object.values(data);
    return `${headers.join(',')}\n${values.join(',')}`;
  }

  /**
   * Export to binary format (ArrayBuffer)
   */
  exportToBinary(data) {
    // Convert data to JSON string first
    const jsonString = JSON.stringify(data);

    // Create ArrayBuffer
    const buffer = new ArrayBuffer(jsonString.length * 2);
    const view = new Uint16Array(buffer);

    // Encode string to buffer
    for (let i = 0; i < jsonString.length; i++) {
      view[i] = jsonString.charCodeAt(i);
    }

    return buffer;
  }

  /**
   * Export shader configuration
   */
  exportShaderConfig(data) {
    const config = {
      version: '1.0.0',
      type: 'shader-configuration',
      timestamp: new Date().toISOString(),
      uniforms: {},
      attributes: {},
      defines: {},
      parameters: data.parameters || {}
    };

    // Extract shader-specific data
    if (data.uniforms) config.uniforms = data.uniforms;
    if (data.attributes) config.attributes = data.attributes;
    if (data.defines) config.defines = data.defines;

    // Add quaternion-specific uniforms if present
    if (data.quaternion) {
      config.uniforms.uQuaternion = {
        type: 'vec4',
        value: data.quaternion
      };
    }

    return JSON.stringify(config, null, 2);
  }

  /**
   * Export WebGL-compatible format
   */
  exportWebGLFormat(data) {
    const webglData = {
      version: '1.0.0',
      type: 'webgl-data',
      buffers: {},
      textures: {},
      uniforms: {},
      attributes: {}
    };

    // Process vertex data
    if (data.vertices) {
      webglData.buffers.vertices = {
        data: Array.isArray(data.vertices) ? data.vertices : Array.from(data.vertices),
        itemSize: data.vertexSize || 3,
        numItems: data.vertices.length / (data.vertexSize || 3)
      };
    }

    // Process index data
    if (data.indices) {
      webglData.buffers.indices = {
        data: Array.isArray(data.indices) ? data.indices : Array.from(data.indices),
        itemSize: 1,
        numItems: data.indices.length
      };
    }

    // Process color data
    if (data.colors) {
      webglData.buffers.colors = {
        data: Array.isArray(data.colors) ? data.colors : Array.from(data.colors),
        itemSize: data.colorSize || 4,
        numItems: data.colors.length / (data.colorSize || 4)
      };
    }

    return JSON.stringify(webglData, null, 2);
  }

  /**
   * Export parameter preset
   */
  exportPreset(data) {
    const preset = {
      version: '1.0.0',
      type: 'parameter-preset',
      name: data.name || 'Unnamed Preset',
      description: data.description || '',
      timestamp: new Date().toISOString(),
      parameters: data.parameters || data,
      metadata: {
        created: new Date().toISOString(),
        author: data.author || 'VIB34D SDK',
        tags: data.tags || []
      }
    };

    return JSON.stringify(preset, null, 2);
  }

  /**
   * Export quaternion data
   */
  exportQuaternionData(data) {
    const quaternionData = {
      version: '1.0.0',
      type: 'quaternion-data',
      quaternions: []
    };

    if (Array.isArray(data)) {
      quaternionData.quaternions = data.map(q => ({
        x: q.x || q[0] || 0,
        y: q.y || q[1] || 0,
        z: q.z || q[2] || 0,
        w: q.w || q[3] || 1
      }));
    } else if (data.x !== undefined || data[0] !== undefined) {
      // Single quaternion
      quaternionData.quaternions.push({
        x: data.x || data[0] || 0,
        y: data.y || data[1] || 0,
        z: data.z || data[2] || 0,
        w: data.w || data[3] || 1
      });
    }

    // Add rotation matrices if requested
    if (data.includeMatrices) {
      quaternionData.rotationMatrices = quaternionData.quaternions.map(q =>
        this.quaternionToMatrix(q)
      );
    }

    return JSON.stringify(quaternionData, null, 2);
  }

  /**
   * Export 4D geometry
   */
  export4DGeometry(data) {
    const geometry = {
      version: '1.0.0',
      type: '4d-geometry',
      vertices: data.vertices || [],
      edges: data.edges || [],
      faces: data.faces || [],
      cells: data.cells || [],
      metadata: {
        dimension: 4,
        vertexCount: (data.vertices || []).length,
        edgeCount: (data.edges || []).length,
        faceCount: (data.faces || []).length,
        cellCount: (data.cells || []).length,
        polytope: data.polytopeType || 'custom'
      }
    };

    return JSON.stringify(geometry, null, 2);
  }

  /**
   * Export XR scene data
   */
  exportXRScene(data) {
    const scene = {
      version: '1.0.0',
      type: 'xr-scene',
      timestamp: new Date().toISOString(),
      objects: data.objects || [],
      cameras: data.cameras || [],
      lights: data.lights || [],
      environment: data.environment || {},
      settings: {
        renderMode: data.renderMode || '4d-projection',
        quaternionMode: data.quaternionMode || true,
        spatialComputing: data.spatialComputing || true
      }
    };

    return JSON.stringify(scene, null, 2);
  }

  /**
   * Convert quaternion to rotation matrix
   */
  quaternionToMatrix(q) {
    const { x, y, z, w } = q;
    return [
      1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y, 0,
      2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x, 0,
      2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y, 0,
      0, 0, 0, 1
    ];
  }

  /**
   * Get available export formats
   */
  getAvailableFormats() {
    return Array.from(this.formats.keys());
  }

  /**
   * Get format information
   */
  getFormatInfo(format) {
    const formatDescriptions = {
      'json': 'Pretty-printed JSON format',
      'json-compact': 'Compact JSON format (no whitespace)',
      'csv': 'Comma-separated values',
      'binary': 'Binary ArrayBuffer format',
      'shader-config': 'Shader configuration with uniforms and attributes',
      'webgl': 'WebGL-compatible buffer format',
      'preset': 'Parameter preset format',
      'quaternion': 'Quaternion data format',
      'geometry-4d': '4D geometry format (vertices, edges, faces, cells)',
      'xr-scene': 'XR scene description format'
    };

    return {
      name: format,
      description: formatDescriptions[format] || 'Custom format',
      available: this.formats.has(format)
    };
  }

  /**
   * Add entry to export history
   */
  addToHistory(entry) {
    this.exportHistory.push(entry);

    // Trim history if too large
    if (this.exportHistory.length > this.maxHistorySize) {
      this.exportHistory.shift();
    }
  }

  /**
   * Get export history
   */
  getHistory() {
    return [...this.exportHistory];
  }

  /**
   * Clear export history
   */
  clearHistory() {
    this.exportHistory = [];
  }

  /**
   * Estimate data size
   */
  estimateSize(data) {
    if (typeof data === 'string') {
      return data.length;
    }
    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }
    return JSON.stringify(data).length;
  }

  /**
   * Batch export to multiple formats
   */
  async exportMultiple(data, formats, options = {}) {
    const results = {};

    for (const format of formats) {
      try {
        results[format] = await this.export(data, format, options);
      } catch (error) {
        results[format] = { error: error.message };
      }
    }

    return results;
  }
}
