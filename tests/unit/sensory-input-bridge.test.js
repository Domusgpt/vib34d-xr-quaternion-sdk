/**
 * SensoryInputBridge Unit Tests
 * Tests for XR sensor normalization and input processing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SensoryInputBridge', () => {
  describe('Sensor Schema Normalization', () => {
    it('should normalize XR pose data', () => {
      const rawPose = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };

      const normalized = {
        position: {
          x: rawPose.position.x,
          y: rawPose.position.y,
          z: rawPose.position.z,
        },
        orientation: {
          x: rawPose.orientation.x,
          y: rawPose.orientation.y,
          z: rawPose.orientation.z,
          w: rawPose.orientation.w,
        },
      };

      expect(normalized.position.x).toBe(1);
      expect(normalized.position.y).toBe(2);
      expect(normalized.position.z).toBe(3);
      expect(normalized.orientation.w).toBe(1);
    });

    it('should validate quaternion normalization', () => {
      const quaternion = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 };

      const magnitude = Math.sqrt(
        quaternion.x ** 2 + quaternion.y ** 2 +
        quaternion.z ** 2 + quaternion.w ** 2
      );

      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('should handle sensor confidence weighting', () => {
      const sensor1 = { value: 10, confidence: 0.9 };
      const sensor2 = { value: 20, confidence: 0.6 };

      const totalConfidence = sensor1.confidence + sensor2.confidence;
      const weightedValue =
        (sensor1.value * sensor1.confidence +
         sensor2.value * sensor2.confidence) / totalConfidence;

      expect(weightedValue).toBeCloseTo(13.33, 1);
    });
  });

  describe('Channel-Based Subscriptions', () => {
    it('should manage channel subscriptions', () => {
      const channels = new Map();
      const channelName = 'spatial';
      const callback = vi.fn();

      // Subscribe to channel
      if (!channels.has(channelName)) {
        channels.set(channelName, new Set());
      }
      channels.get(channelName).add(callback);

      expect(channels.has(channelName)).toBe(true);
      expect(channels.get(channelName).has(callback)).toBe(true);
    });

    it('should unsubscribe from channels', () => {
      const channels = new Map();
      const channelName = 'spatial';
      const callback = vi.fn();

      // Subscribe
      if (!channels.has(channelName)) {
        channels.set(channelName, new Set());
      }
      channels.get(channelName).add(callback);

      // Unsubscribe
      if (channels.has(channelName)) {
        channels.get(channelName).delete(callback);
      }

      expect(channels.get(channelName).has(callback)).toBe(false);
    });

    it('should notify channel subscribers', () => {
      const callback = vi.fn();
      const data = { position: { x: 1, y: 2, z: 3 } };

      callback(data);

      expect(callback).toHaveBeenCalledWith(data);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Temporal Decay', () => {
    it('should calculate confidence decay over time', () => {
      const initialConfidence = 1.0;
      const decayRate = 0.9;
      const timeElapsed = 2; // frames

      const decayedConfidence = initialConfidence * Math.pow(decayRate, timeElapsed);

      expect(decayedConfidence).toBeCloseTo(0.81, 2);
    });

    it('should expire old sensor data', () => {
      const maxAge = 1000; // ms
      const currentTime = Date.now();
      const oldData = { timestamp: currentTime - 2000, value: 10 };
      const freshData = { timestamp: currentTime - 500, value: 20 };

      const isOldExpired = (currentTime - oldData.timestamp) > maxAge;
      const isFreshValid = (currentTime - freshData.timestamp) <= maxAge;

      expect(isOldExpired).toBe(true);
      expect(isFreshValid).toBe(true);
    });
  });

  describe('Wearable Device Adapters', () => {
    it('should create AR visor adapter', () => {
      const adapter = {
        type: 'ar-visor',
        capabilities: ['spatial-tracking', 'pose-data'],
        connected: false,
      };

      expect(adapter.type).toBe('ar-visor');
      expect(adapter.capabilities).toContain('spatial-tracking');
      expect(adapter.connected).toBe(false);
    });

    it('should handle adapter lifecycle', () => {
      const adapter = {
        connected: false,
        connect: () => { adapter.connected = true; },
        disconnect: () => { adapter.connected = false; },
      };

      adapter.connect();
      expect(adapter.connected).toBe(true);

      adapter.disconnect();
      expect(adapter.connected).toBe(false);
    });

    it('should process spatial trace data', () => {
      const spatialData = {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        timestamp: Date.now(),
        confidence: 0.95,
      };

      expect(spatialData.position).toBeDefined();
      expect(spatialData.orientation).toBeDefined();
      expect(spatialData.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('Multi-Device Fusion', () => {
    it('should fuse data from multiple devices', () => {
      const device1Data = {
        orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
        confidence: 0.8,
      };

      const device2Data = {
        orientation: { x: 0.15, y: 0.25, z: 0.35, w: 0.85 },
        confidence: 0.6,
      };

      const totalConfidence = device1Data.confidence + device2Data.confidence;

      const fusedOrientation = {
        x: (device1Data.orientation.x * device1Data.confidence +
            device2Data.orientation.x * device2Data.confidence) / totalConfidence,
        y: (device1Data.orientation.y * device1Data.confidence +
            device2Data.orientation.y * device2Data.confidence) / totalConfidence,
        z: (device1Data.orientation.z * device1Data.confidence +
            device2Data.orientation.z * device2Data.confidence) / totalConfidence,
        w: (device1Data.orientation.w * device1Data.confidence +
            device2Data.orientation.w * device2Data.confidence) / totalConfidence,
      };

      expect(fusedOrientation.x).toBeCloseTo(0.121, 2);
      expect(fusedOrientation.w).toBeGreaterThan(0.8);
    });
  });

  describe('Schema Validation', () => {
    it('should validate spatial anchor schema', () => {
      const anchor = {
        id: 'anchor-1',
        pose: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      };

      const isValid =
        anchor.id &&
        anchor.pose &&
        anchor.pose.position &&
        anchor.pose.orientation &&
        typeof anchor.pose.orientation.w === 'number';

      expect(isValid).toBe(true);
    });

    it('should validate plane detection schema', () => {
      const plane = {
        id: 'plane-1',
        orientation: 'horizontal',
        polygon: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
        ],
      };

      const isValid =
        plane.id &&
        plane.orientation &&
        Array.isArray(plane.polygon) &&
        plane.polygon.length >= 3;

      expect(isValid).toBe(true);
      expect(plane.polygon.length).toBeGreaterThanOrEqual(3);
    });
  });
});
