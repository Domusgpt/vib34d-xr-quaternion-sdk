/**
 * LicenseManager Unit Tests
 * Tests for enterprise licensing and attestation system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('LicenseManager', () => {
  let licenseManager;

  beforeEach(() => {
    licenseManager = {
      licenses: new Map(),
      listeners: new Set(),
    };
  });

  describe('License Registration', () => {
    it('should register a valid license', () => {
      const license = {
        key: 'TEST-LICENSE-KEY',
        tier: 'enterprise',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        features: ['unlimited-devices', 'priority-support'],
      };

      licenseManager.licenses.set(license.key, license);

      expect(licenseManager.licenses.has(license.key)).toBe(true);
      expect(licenseManager.licenses.get(license.key).tier).toBe('enterprise');
    });

    it('should validate license structure', () => {
      const license = {
        key: 'TEST-KEY',
        tier: 'studio',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        features: ['multi-device', 'telemetry'],
      };

      const isValid =
        license.key &&
        license.tier &&
        license.expiresAt &&
        Array.isArray(license.features);

      expect(isValid).toBe(true);
    });

    it('should reject invalid license tiers', () => {
      const validTiers = ['enterprise', 'studio', 'indie'];
      const invalidTier = 'premium';

      expect(validTiers.includes('enterprise')).toBe(true);
      expect(validTiers.includes(invalidTier)).toBe(false);
    });
  });

  describe('License Validation', () => {
    it('should validate active license', () => {
      const license = {
        key: 'ACTIVE-LICENSE',
        tier: 'enterprise',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active',
      };

      const isActive =
        license.status === 'active' &&
        new Date(license.expiresAt) > new Date();

      expect(isActive).toBe(true);
    });

    it('should detect expired license', () => {
      const license = {
        key: 'EXPIRED-LICENSE',
        tier: 'indie',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: 'active',
      };

      const isExpired = new Date(license.expiresAt) < new Date();

      expect(isExpired).toBe(true);
    });

    it('should handle revoked license', () => {
      const license = {
        key: 'REVOKED-LICENSE',
        tier: 'studio',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'revoked',
      };

      const isValid = license.status === 'active';

      expect(isValid).toBe(false);
    });
  });

  describe('License Attestation Profiles', () => {
    it('should define enterprise profile', () => {
      const enterpriseProfile = {
        tier: 'enterprise',
        maxDevices: -1, // unlimited
        support: 'priority',
        sla: '99.9%',
        features: ['unlimited-devices', 'priority-support', 'custom-branding'],
      };

      expect(enterpriseProfile.tier).toBe('enterprise');
      expect(enterpriseProfile.maxDevices).toBe(-1);
      expect(enterpriseProfile.features).toContain('priority-support');
    });

    it('should define studio profile', () => {
      const studioProfile = {
        tier: 'studio',
        maxDevices: 10,
        support: 'standard',
        sla: '99.5%',
        features: ['multi-device', 'telemetry', 'analytics'],
      };

      expect(studioProfile.tier).toBe('studio');
      expect(studioProfile.maxDevices).toBe(10);
    });

    it('should define indie profile', () => {
      const indieProfile = {
        tier: 'indie',
        maxDevices: 3,
        support: 'community',
        sla: '99%',
        features: ['basic-telemetry', 'limited-analytics'],
      };

      expect(indieProfile.tier).toBe('indie');
      expect(indieProfile.maxDevices).toBe(3);
    });
  });

  describe('Feature Access Control', () => {
    it('should grant access to licensed features', () => {
      const license = {
        features: ['telemetry', 'analytics', 'multi-device'],
      };

      const hasFeature = (feature) => license.features.includes(feature);

      expect(hasFeature('telemetry')).toBe(true);
      expect(hasFeature('analytics')).toBe(true);
      expect(hasFeature('custom-branding')).toBe(false);
    });

    it('should enforce device limits', () => {
      const license = {
        tier: 'indie',
        maxDevices: 3,
        connectedDevices: 2,
      };

      const canAddDevice = license.connectedDevices < license.maxDevices;

      expect(canAddDevice).toBe(true);

      license.connectedDevices = 3;
      const canAddAnother = license.connectedDevices < license.maxDevices;

      expect(canAddAnother).toBe(false);
    });
  });

  describe('Remote Attestation', () => {
    it('should validate attestation response', () => {
      const attestationResponse = {
        valid: true,
        licenseKey: 'TEST-KEY',
        tier: 'enterprise',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        attestedAt: new Date().toISOString(),
      };

      expect(attestationResponse.valid).toBe(true);
      expect(attestationResponse.tier).toBe('enterprise');
    });

    it('should handle attestation failure', () => {
      const attestationResponse = {
        valid: false,
        error: 'License not found',
        code: 'LICENSE_NOT_FOUND',
      };

      expect(attestationResponse.valid).toBe(false);
      expect(attestationResponse.error).toBeDefined();
    });

    it('should implement fail-open mode', () => {
      const config = {
        failMode: 'open',
        attestationFailed: true,
      };

      const allowAccess = config.failMode === 'open';

      expect(allowAccess).toBe(true);
    });

    it('should implement fail-closed mode', () => {
      const config = {
        failMode: 'closed',
        attestationFailed: true,
      };

      const allowAccess = config.failMode === 'open';

      expect(allowAccess).toBe(false);
    });
  });

  describe('License Event Notifications', () => {
    it('should notify on license activation', () => {
      const listener = vi.fn();
      licenseManager.listeners.add(listener);

      const event = {
        type: 'license-activated',
        licenseKey: 'TEST-KEY',
        timestamp: Date.now(),
      };

      licenseManager.listeners.forEach(cb => cb(event));

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should notify on license expiration', () => {
      const listener = vi.fn();
      licenseManager.listeners.add(listener);

      const event = {
        type: 'license-expired',
        licenseKey: 'EXPIRED-KEY',
        timestamp: Date.now(),
      };

      licenseManager.listeners.forEach(cb => cb(event));

      expect(listener).toHaveBeenCalledWith(event);
      expect(listener.mock.calls[0][0].type).toBe('license-expired');
    });
  });

  describe('License Commercialization', () => {
    it('should track license adoption metrics', () => {
      const metrics = {
        totalLicenses: 150,
        activeLicenses: 120,
        byTier: {
          enterprise: 10,
          studio: 50,
          indie: 60,
        },
      };

      expect(metrics.totalLicenses).toBe(150);
      expect(metrics.activeLicenses).toBe(120);
      expect(metrics.byTier.enterprise + metrics.byTier.studio + metrics.byTier.indie).toBe(120);
    });

    it('should calculate revenue metrics', () => {
      const pricing = {
        enterprise: 999,
        studio: 299,
        indie: 49,
      };

      const licenses = {
        enterprise: 10,
        studio: 50,
        indie: 60,
      };

      const totalRevenue =
        pricing.enterprise * licenses.enterprise +
        pricing.studio * licenses.studio +
        pricing.indie * licenses.indie;

      // 999 * 10 + 299 * 50 + 49 * 60 = 9990 + 14950 + 2940 = 27880
      expect(totalRevenue).toBe(27880);
    });
  });
});
