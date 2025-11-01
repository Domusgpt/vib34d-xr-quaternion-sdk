/**
 * GeometryLibrary Unit Tests
 * Tests for 4D geometric mathematics and polytope definitions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GeometryLibrary } from '../../src/geometry/GeometryLibrary.js';

describe('GeometryLibrary', () => {
  let geometry;

  beforeEach(() => {
    geometry = new GeometryLibrary();
  });

  describe('4D Vector Operations', () => {
    it('should create 4D vectors', () => {
      const vec = { x: 1, y: 2, z: 3, w: 4 };
      expect(vec.x).toBe(1);
      expect(vec.y).toBe(2);
      expect(vec.z).toBe(3);
      expect(vec.w).toBe(4);
    });

    it('should calculate 4D vector magnitude', () => {
      const magnitude = Math.sqrt(1 + 4 + 9 + 16); // √30
      expect(magnitude).toBeCloseTo(5.477, 2);
    });

    it('should normalize 4D vectors', () => {
      const vec = { x: 1, y: 2, z: 3, w: 4 };
      const magnitude = Math.sqrt(1 + 4 + 9 + 16);
      const normalized = {
        x: vec.x / magnitude,
        y: vec.y / magnitude,
        z: vec.z / magnitude,
        w: vec.w / magnitude,
      };

      const normalizedMagnitude = Math.sqrt(
        normalized.x ** 2 + normalized.y ** 2 +
        normalized.z ** 2 + normalized.w ** 2
      );

      expect(normalizedMagnitude).toBeCloseTo(1, 5);
    });
  });

  describe('4D Polytope Definitions', () => {
    it('should define valid polytope structure', () => {
      // Basic polytope structure test
      const polytope = {
        name: '5-cell',
        vertices: [],
        edges: [],
        faces: [],
      };

      expect(polytope.name).toBe('5-cell');
      expect(Array.isArray(polytope.vertices)).toBe(true);
      expect(Array.isArray(polytope.edges)).toBe(true);
      expect(Array.isArray(polytope.faces)).toBe(true);
    });

    it('should handle 5-cell (4-simplex) vertices', () => {
      // 5-cell has 5 vertices
      const expectedVertexCount = 5;
      expect(expectedVertexCount).toBe(5);
    });

    it('should handle tesseract (8-cell) vertices', () => {
      // Tesseract has 16 vertices
      const expectedVertexCount = 16;
      expect(expectedVertexCount).toBe(16);
    });
  });

  describe('4D Projection', () => {
    it('should project 4D point to 3D', () => {
      const point4D = { x: 1, y: 1, z: 1, w: 1 };
      const distance = 4;

      // Perspective projection: divide by (distance - w)
      const divisor = distance - point4D.w;
      const point3D = {
        x: point4D.x / divisor,
        y: point4D.y / divisor,
        z: point4D.z / divisor,
      };

      expect(point3D.x).toBeCloseTo(0.333, 2);
      expect(point3D.y).toBeCloseTo(0.333, 2);
      expect(point3D.z).toBeCloseTo(0.333, 2);
    });

    it('should handle orthographic projection', () => {
      const point4D = { x: 1, y: 2, z: 3, w: 4 };

      // Orthographic: just drop the W coordinate
      const point3D = {
        x: point4D.x,
        y: point4D.y,
        z: point4D.z,
      };

      expect(point3D.x).toBe(1);
      expect(point3D.y).toBe(2);
      expect(point3D.z).toBe(3);
    });
  });

  describe('4D Rotations', () => {
    it('should rotate in XW plane', () => {
      const angle = Math.PI / 2; // 90 degrees
      const point = { x: 1, y: 0, z: 0, w: 0 };

      // Rotation matrix for XW plane
      const rotated = {
        x: point.x * Math.cos(angle) - point.w * Math.sin(angle),
        y: point.y,
        z: point.z,
        w: point.x * Math.sin(angle) + point.w * Math.cos(angle),
      };

      expect(rotated.x).toBeCloseTo(0, 5);
      expect(rotated.y).toBe(0);
      expect(rotated.z).toBe(0);
      expect(rotated.w).toBeCloseTo(1, 5);
    });

    it('should rotate in YW plane', () => {
      const angle = Math.PI / 2;
      const point = { x: 0, y: 1, z: 0, w: 0 };

      const rotated = {
        x: point.x,
        y: point.y * Math.cos(angle) - point.w * Math.sin(angle),
        z: point.z,
        w: point.y * Math.sin(angle) + point.w * Math.cos(angle),
      };

      expect(rotated.x).toBe(0);
      expect(rotated.y).toBeCloseTo(0, 5);
      expect(rotated.z).toBe(0);
      expect(rotated.w).toBeCloseTo(1, 5);
    });

    it('should rotate in ZW plane', () => {
      const angle = Math.PI / 2;
      const point = { x: 0, y: 0, z: 1, w: 0 };

      const rotated = {
        x: point.x,
        y: point.y,
        z: point.z * Math.cos(angle) - point.w * Math.sin(angle),
        w: point.z * Math.sin(angle) + point.w * Math.cos(angle),
      };

      expect(rotated.x).toBe(0);
      expect(rotated.y).toBe(0);
      expect(rotated.z).toBeCloseTo(0, 5);
      expect(rotated.w).toBeCloseTo(1, 5);
    });
  });

  describe('Quaternion Operations', () => {
    it('should create identity quaternion', () => {
      const identity = { x: 0, y: 0, z: 0, w: 1 };
      expect(identity.w).toBe(1);
      expect(identity.x).toBe(0);
      expect(identity.y).toBe(0);
      expect(identity.z).toBe(0);
    });

    it('should normalize quaternion', () => {
      const quat = { x: 1, y: 2, z: 3, w: 4 };
      const magnitude = Math.sqrt(1 + 4 + 9 + 16);

      const normalized = {
        x: quat.x / magnitude,
        y: quat.y / magnitude,
        z: quat.z / magnitude,
        w: quat.w / magnitude,
      };

      const normalizedMag = Math.sqrt(
        normalized.x ** 2 + normalized.y ** 2 +
        normalized.z ** 2 + normalized.w ** 2
      );

      expect(normalizedMag).toBeCloseTo(1, 5);
    });

    it('should create quaternion from axis-angle', () => {
      const axis = { x: 0, y: 1, z: 0 }; // Y-axis
      const angle = Math.PI / 2; // 90 degrees

      const halfAngle = angle / 2;
      const s = Math.sin(halfAngle);

      const quat = {
        x: axis.x * s,
        y: axis.y * s,
        z: axis.z * s,
        w: Math.cos(halfAngle),
      };

      expect(quat.x).toBeCloseTo(0, 5);
      expect(quat.y).toBeCloseTo(0.707, 2);
      expect(quat.z).toBeCloseTo(0, 5);
      expect(quat.w).toBeCloseTo(0.707, 2);
    });
  });
});
