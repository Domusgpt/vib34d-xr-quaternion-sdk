export const DEFAULT_TELEMETRY_EVENT_SCHEMAS = [
  {
    prefix: 'adaptive.',
    classification: 'interaction',
    requiresConsent: false,
    retention: 'session',
    metadata: { channel: 'adaptive-engine' }
  },
  {
    prefix: 'design.layout.',
    classification: 'analytics',
    requiresConsent: true,
    retention: 'quarter',
    redact: ['licenseKey']
  },
  {
    prefix: 'design.telemetry.',
    classification: 'system',
    requiresConsent: false,
    retention: 'session'
  },
  {
    prefix: 'compliance.',
    classification: 'compliance',
    requiresConsent: false,
    retention: 'regulatory'
  },
  {
    prefix: 'privacy.',
    classification: 'compliance',
    requiresConsent: false,
    retention: 'regulatory'
  },
  {
    prefix: 'sensors.adapter.',
    classification: 'system',
    requiresConsent: false,
    retention: 'session',
    redact: ['licenseKey']
  },
  {
    prefix: 'sensors.schema',
    classification: 'compliance',
    requiresConsent: false,
    retention: 'regulatory'
  },
  {
    prefix: 'biometric.',
    classification: 'biometric',
    requiresConsent: true,
    retention: '30d',
    redact: ['identity', 'userId'],
    mask: {
      sample: value => {
        if (!value || typeof value !== 'object') {
          return value;
        }
        const clone = { ...value };
        if (typeof clone.raw === 'number') {
          clone.raw = Math.round(clone.raw * 1000) / 1000;
        }
        return clone;
      }
    }
  }
];
