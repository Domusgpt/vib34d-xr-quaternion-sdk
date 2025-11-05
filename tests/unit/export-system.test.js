/**
 * Tests for ExportSystem
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ExportSystem } from '../../src/features/ExportSystem.js';

describe('ExportSystem', () => {
  let exportSystem;

  beforeEach(() => {
    exportSystem = new ExportSystem();
  });

  describe('Initialization', () => {
    it('should create export system with default options', () => {
      expect(exportSystem).toBeDefined();
      expect(exportSystem.formats).toBeInstanceOf(Map);
    });

    it('should initialize export history', () => {
      expect(exportSystem.exportHistory).toEqual([]);
    });

    it('should set max history size', () => {
      expect(exportSystem.maxHistorySize).toBe(100);
    });

    it('should initialize with custom max history size', () => {
      const custom = new ExportSystem({ maxHistorySize: 50 });
      expect(custom.maxHistorySize).toBe(50);
    });

    it('should register built-in formats on initialization', () => {
      expect(exportSystem.formats.size).toBeGreaterThan(0);
      expect(exportSystem.formats.has('json')).toBe(true);
      expect(exportSystem.formats.has('csv')).toBe(true);
    });
  });

  describe('Format Registration', () => {
    it('should register custom export format', () => {
      const customHandler = (data) => `custom:${JSON.stringify(data)}`;
      exportSystem.registerFormat('custom', customHandler);

      expect(exportSystem.formats.has('custom')).toBe(true);
    });

    it('should throw error if handler is not a function', () => {
      expect(() => {
        exportSystem.registerFormat('invalid', 'not-a-function');
      }).toThrow('Export format handler must be a function');
    });

    it('should override existing format', () => {
      const newHandler = (data) => 'new-json';
      exportSystem.registerFormat('json', newHandler);

      expect(exportSystem.formats.get('json')).toBe(newHandler);
    });
  });

  describe('Available Formats', () => {
    it('should get list of available formats', () => {
      const formats = exportSystem.getAvailableFormats();
      expect(formats).toContain('json');
      expect(formats).toContain('json-compact');
      expect(formats).toContain('csv');
      expect(formats).toContain('binary');
    });

    it('should have all 10 built-in formats', () => {
      const formats = exportSystem.getAvailableFormats();
      expect(formats).toContain('json');
      expect(formats).toContain('json-compact');
      expect(formats).toContain('csv');
      expect(formats).toContain('binary');
      expect(formats).toContain('shader-config');
      expect(formats).toContain('webgl');
      expect(formats).toContain('preset');
      expect(formats).toContain('quaternion');
      expect(formats).toContain('geometry-4d');
      expect(formats).toContain('xr-scene');
    });
  });

  describe('Format Information', () => {
    it('should get format information', () => {
      const info = exportSystem.getFormatInfo('json');
      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('available');
    });

    it('should indicate format availability', () => {
      const info = exportSystem.getFormatInfo('json');
      expect(info.available).toBe(true);
    });

    it('should handle non-existent format', () => {
      const info = exportSystem.getFormatInfo('non-existent');
      expect(info.name).toBe('non-existent');
      expect(info.available).toBe(false);
      expect(info.description).toBe('Custom format');
    });
  });

  describe('JSON Export', () => {
    it('should export to pretty JSON', async () => {
      const data = { name: 'test', value: 42 };
      const result = await exportSystem.export(data, 'json');

      expect(result).toContain('"name"');
      expect(result).toContain('"test"');
      expect(result).toContain('\n'); // Pretty printed
    });

    it('should export to compact JSON', async () => {
      const data = { name: 'test', value: 42 };
      const result = await exportSystem.export(data, 'json-compact');

      expect(result).not.toContain('\n');
      expect(result).toBe('{"name":"test","value":42}');
    });

    it('should handle nested objects', async () => {
      const data = {
        outer: {
          inner: { value: 123 }
        }
      };
      const result = await exportSystem.export(data, 'json');
      const parsed = JSON.parse(result);

      expect(parsed.outer.inner.value).toBe(123);
    });

    it('should handle arrays', async () => {
      const data = [1, 2, 3, 4, 5];
      const result = await exportSystem.export(data, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('CSV Export', () => {
    it('should export array of objects to CSV', async () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 }
      ];
      const result = await exportSystem.export(data, 'csv');

      expect(result).toContain('name,age');
      expect(result).toContain('Alice,30');
      expect(result).toContain('Bob,25');
    });

    it('should handle empty array', async () => {
      const data = [];
      const result = await exportSystem.export(data, 'csv');
      expect(result).toBe('');
    });

    it('should handle single object as two-row CSV', async () => {
      const data = { name: 'Alice', age: 30 };
      const result = await exportSystem.export(data, 'csv');

      const lines = result.split('\n');
      expect(lines[0]).toBe('name,age');
      expect(lines[1]).toBe('Alice,30');
    });

    it('should escape commas in values', async () => {
      const data = [
        { name: 'Smith, John', age: 30 }
      ];
      const result = await exportSystem.export(data, 'csv');

      expect(result).toContain('"Smith, John"');
    });

    it('should escape quotes in values', async () => {
      const data = [
        { name: 'John "Johnny" Doe', age: 30 }
      ];
      const result = await exportSystem.export(data, 'csv');

      expect(result).toContain('""Johnny""');
    });
  });

  describe('Binary Export', () => {
    it('should export to binary ArrayBuffer', async () => {
      const data = { test: 'value' };
      const result = await exportSystem.export(data, 'binary');

      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('should create buffer with correct size', async () => {
      const data = { x: 1 };
      const result = await exportSystem.export(data, 'binary');
      const jsonLength = JSON.stringify(data).length;

      expect(result.byteLength).toBe(jsonLength * 2);
    });

    it('should be decodable back to JSON', async () => {
      const data = { name: 'test', value: 42 };
      const buffer = await exportSystem.export(data, 'binary');

      // Decode back
      const view = new Uint16Array(buffer);
      let decoded = '';
      for (let i = 0; i < view.length; i++) {
        decoded += String.fromCharCode(view[i]);
      }

      const parsed = JSON.parse(decoded);
      expect(parsed).toEqual(data);
    });
  });

  describe('Shader Config Export', () => {
    it('should export shader configuration', async () => {
      const data = {
        uniforms: {
          uTime: { type: 'float', value: 0 }
        },
        attributes: {
          aPosition: { type: 'vec3' }
        }
      };
      const result = await exportSystem.export(data, 'shader-config');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('shader-configuration');
      expect(parsed.uniforms).toEqual(data.uniforms);
      expect(parsed.attributes).toEqual(data.attributes);
    });

    it('should include version in shader config', async () => {
      const data = {};
      const result = await exportSystem.export(data, 'shader-config');
      const parsed = JSON.parse(result);

      expect(parsed.version).toBe('1.0.0');
    });

    it('should add quaternion uniforms if present', async () => {
      const data = {
        quaternion: [0, 0, 0, 1]
      };
      const result = await exportSystem.export(data, 'shader-config');
      const parsed = JSON.parse(result);

      expect(parsed.uniforms.uQuaternion).toBeDefined();
      expect(parsed.uniforms.uQuaternion.type).toBe('vec4');
    });

    it('should include timestamp', async () => {
      const data = {};
      const result = await exportSystem.export(data, 'shader-config');
      const parsed = JSON.parse(result);

      const timestamp = new Date(parsed.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });
  });

  describe('WebGL Format Export', () => {
    it('should export WebGL buffer data', async () => {
      const data = {
        vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        indices: [0, 1, 2]
      };
      const result = await exportSystem.export(data, 'webgl');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('webgl-data');
      expect(parsed.buffers).toHaveProperty('vertices');
      expect(parsed.buffers).toHaveProperty('indices');
    });

    it('should calculate vertex buffer info', async () => {
      const data = {
        vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        vertexSize: 3
      };
      const result = await exportSystem.export(data, 'webgl');
      const parsed = JSON.parse(result);

      expect(parsed.buffers.vertices.itemSize).toBe(3);
      expect(parsed.buffers.vertices.numItems).toBe(3);
    });

    it('should handle color data', async () => {
      const data = {
        colors: [1, 0, 0, 1, 0, 1, 0, 1],
        colorSize: 4
      };
      const result = await exportSystem.export(data, 'webgl');
      const parsed = JSON.parse(result);

      expect(parsed.buffers.colors).toBeDefined();
      expect(parsed.buffers.colors.itemSize).toBe(4);
    });

    it('should convert typed arrays to regular arrays', async () => {
      const data = {
        vertices: new Float32Array([0, 0, 0])
      };
      const result = await exportSystem.export(data, 'webgl');
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed.buffers.vertices.data)).toBe(true);
    });
  });

  describe('Preset Export', () => {
    it('should export parameter preset', async () => {
      const data = {
        name: 'My Preset',
        parameters: { rotationSpeed: 0.5, complexity: 0.7 }
      };
      const result = await exportSystem.export(data, 'preset');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('parameter-preset');
      expect(parsed.name).toBe('My Preset');
      expect(parsed.parameters).toEqual(data.parameters);
    });

    it('should add metadata to preset', async () => {
      const data = { parameters: {} };
      const result = await exportSystem.export(data, 'preset');
      const parsed = JSON.parse(result);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata).toHaveProperty('created');
      expect(parsed.metadata).toHaveProperty('author');
    });

    it('should handle description and tags', async () => {
      const data = {
        description: 'Test preset',
        tags: ['experimental', 'fast'],
        parameters: {}
      };
      const result = await exportSystem.export(data, 'preset');
      const parsed = JSON.parse(result);

      expect(parsed.description).toBe('Test preset');
      expect(parsed.metadata.tags).toEqual(['experimental', 'fast']);
    });
  });

  describe('Quaternion Export', () => {
    it('should export single quaternion', async () => {
      const data = { x: 0, y: 0, z: 0, w: 1 };
      const result = await exportSystem.export(data, 'quaternion');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('quaternion-data');
      expect(parsed.quaternions).toHaveLength(1);
      expect(parsed.quaternions[0]).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });

    it('should export array of quaternions', async () => {
      const data = [
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 1, y: 0, z: 0, w: 0 }
      ];
      const result = await exportSystem.export(data, 'quaternion');
      const parsed = JSON.parse(result);

      expect(parsed.quaternions).toHaveLength(2);
    });

    it('should handle array notation', async () => {
      const data = { 0: 1, 1: 2, 2: 3, 3: 4 };
      const result = await exportSystem.export(data, 'quaternion');
      const parsed = JSON.parse(result);

      expect(parsed.quaternions[0]).toEqual({ x: 1, y: 2, z: 3, w: 4 });
    });

    it('should include rotation matrices if requested', async () => {
      const data = {
        x: 0, y: 0, z: 0, w: 1,
        includeMatrices: true
      };
      const result = await exportSystem.export(data, 'quaternion');
      const parsed = JSON.parse(result);

      expect(parsed.rotationMatrices).toBeDefined();
      expect(parsed.rotationMatrices).toHaveLength(1);
    });

    it('should calculate correct rotation matrix', async () => {
      const data = {
        x: 0, y: 0, z: 0, w: 1,
        includeMatrices: true
      };
      const result = await exportSystem.export(data, 'quaternion');
      const parsed = JSON.parse(result);
      const matrix = parsed.rotationMatrices[0];

      // Identity quaternion should produce identity matrix
      expect(matrix[0]).toBe(1);
      expect(matrix[5]).toBe(1);
      expect(matrix[10]).toBe(1);
    });
  });

  describe('4D Geometry Export', () => {
    it('should export 4D geometry data', async () => {
      const data = {
        vertices: [[0, 0, 0, 0], [1, 0, 0, 0]],
        edges: [[0, 1]],
        faces: [],
        cells: []
      };
      const result = await exportSystem.export(data, 'geometry-4d');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('4d-geometry');
      expect(parsed.vertices).toEqual(data.vertices);
      expect(parsed.edges).toEqual(data.edges);
    });

    it('should include metadata', async () => {
      const data = {
        vertices: [[0, 0, 0, 0]],
        edges: [],
        faces: [],
        cells: [],
        polytopeType: 'tesseract'
      };
      const result = await exportSystem.export(data, 'geometry-4d');
      const parsed = JSON.parse(result);

      expect(parsed.metadata.dimension).toBe(4);
      expect(parsed.metadata.vertexCount).toBe(1);
      expect(parsed.metadata.polytope).toBe('tesseract');
    });

    it('should handle empty geometry', async () => {
      const data = {};
      const result = await exportSystem.export(data, 'geometry-4d');
      const parsed = JSON.parse(result);

      expect(parsed.vertices).toEqual([]);
      expect(parsed.edges).toEqual([]);
    });
  });

  describe('XR Scene Export', () => {
    it('should export XR scene data', async () => {
      const data = {
        objects: [{ type: 'mesh', position: [0, 0, 0] }],
        cameras: [{ type: 'perspective' }]
      };
      const result = await exportSystem.export(data, 'xr-scene');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('xr-scene');
      expect(parsed.objects).toEqual(data.objects);
      expect(parsed.cameras).toEqual(data.cameras);
    });

    it('should include default settings', async () => {
      const data = {};
      const result = await exportSystem.export(data, 'xr-scene');
      const parsed = JSON.parse(result);

      expect(parsed.settings.renderMode).toBe('4d-projection');
      expect(parsed.settings.quaternionMode).toBe(true);
      expect(parsed.settings.spatialComputing).toBe(true);
    });

    it('should include timestamp', async () => {
      const data = {};
      const result = await exportSystem.export(data, 'xr-scene');
      const parsed = JSON.parse(result);

      const timestamp = new Date(parsed.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Export History', () => {
    it('should track export history', async () => {
      const data = { test: 'value' };
      await exportSystem.export(data, 'json');

      expect(exportSystem.exportHistory).toHaveLength(1);
    });

    it('should record successful exports', async () => {
      const data = { test: 'value' };
      await exportSystem.export(data, 'json');

      const entry = exportSystem.exportHistory[0];
      expect(entry.success).toBe(true);
      expect(entry.format).toBe('json');
    });

    it('should record failed exports', async () => {
      try {
        await exportSystem.export({}, 'non-existent-format');
      } catch (error) {
        // Expected error
      }

      const entry = exportSystem.exportHistory[0];
      expect(entry.success).toBe(false);
      expect(entry.error).toBeDefined();
    });

    it('should track timestamp', async () => {
      const data = { test: 'value' };
      await exportSystem.export(data, 'json');

      const entry = exportSystem.exportHistory[0];
      expect(typeof entry.timestamp).toBe('number');
    });

    it('should track data size', async () => {
      const data = { test: 'value' };
      await exportSystem.export(data, 'json');

      const entry = exportSystem.exportHistory[0];
      expect(entry.dataSize).toBeGreaterThan(0);
    });

    it('should limit history size', async () => {
      const smallSystem = new ExportSystem({ maxHistorySize: 3 });
      const data = { test: 'value' };

      for (let i = 0; i < 5; i++) {
        await smallSystem.export(data, 'json');
      }

      expect(smallSystem.exportHistory).toHaveLength(3);
    });

    it('should get export history', () => {
      const history = exportSystem.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should clear export history', async () => {
      const data = { test: 'value' };
      await exportSystem.export(data, 'json');

      exportSystem.clearHistory();
      expect(exportSystem.exportHistory).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unsupported format', async () => {
      await expect(
        exportSystem.export({}, 'unsupported-format')
      ).rejects.toThrow('Export format "unsupported-format" not supported');
    });

    it('should include available formats in error message', async () => {
      try {
        await exportSystem.export({}, 'invalid');
      } catch (error) {
        expect(error.message).toContain('Available:');
        expect(error.message).toContain('json');
      }
    });
  });

  describe('Batch Export', () => {
    it('should export to multiple formats', async () => {
      const data = { test: 'value' };
      const results = await exportSystem.exportMultiple(data, ['json', 'json-compact']);

      expect(results).toHaveProperty('json');
      expect(results).toHaveProperty('json-compact');
    });

    it('should handle mixed success and failures', async () => {
      const data = { test: 'value' };
      const results = await exportSystem.exportMultiple(data, ['json', 'invalid-format']);

      expect(results.json).toBeDefined();
      expect(typeof results.json).toBe('string');
      expect(results['invalid-format']).toHaveProperty('error');
    });

    it('should process all formats even if some fail', async () => {
      const data = { test: 'value' };
      const results = await exportSystem.exportMultiple(data, ['json', 'invalid', 'csv']);

      expect(results).toHaveProperty('json');
      expect(results).toHaveProperty('invalid');
      expect(results).toHaveProperty('csv');
    });
  });

  describe('Data Size Estimation', () => {
    it('should estimate string size', () => {
      const size = exportSystem.estimateSize('test string');
      expect(size).toBe(11);
    });

    it('should estimate ArrayBuffer size', () => {
      const buffer = new ArrayBuffer(100);
      const size = exportSystem.estimateSize(buffer);
      expect(size).toBe(100);
    });

    it('should estimate object size via JSON', () => {
      const data = { name: 'test', value: 42 };
      const size = exportSystem.estimateSize(data);
      expect(size).toBe(JSON.stringify(data).length);
    });
  });
});
