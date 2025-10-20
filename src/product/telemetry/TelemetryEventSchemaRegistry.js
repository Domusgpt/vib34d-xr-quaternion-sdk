const DEFAULT_REQUIRES_CONSENT = new Set(['analytics', 'biometric']);

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, clone(val)]));
  }
  return value;
}

function normalizeSchema(schema = {}) {
  if (!schema || (typeof schema.id !== 'string' && typeof schema.prefix !== 'string' && !(schema.match instanceof RegExp))) {
    throw new Error('[TelemetryEventSchemaRegistry] schema requires `id`, `prefix`, or `match`.');
  }

  const entry = {
    id: typeof schema.id === 'string' ? schema.id : null,
    prefix: typeof schema.prefix === 'string' ? schema.prefix : null,
    match: schema.match instanceof RegExp ? schema.match : null,
    classification: schema.classification || null,
    defaults: schema.defaults ? clone(schema.defaults) : null,
    redact: Array.isArray(schema.redact) ? [...schema.redact] : [],
    mask: schema.mask && typeof schema.mask === 'object' ? { ...schema.mask } : null,
    requiresConsent: schema.requiresConsent,
    retention: schema.retention || null,
    validate: typeof schema.validate === 'function' ? schema.validate : null,
    transform: typeof schema.transform === 'function' ? schema.transform : null,
    priority: Number.isFinite(schema.priority) ? schema.priority : 0,
    metadata: schema.metadata && typeof schema.metadata === 'object' ? clone(schema.metadata) : undefined
  };

  if (entry.mask) {
    for (const key of Object.keys(entry.mask)) {
      const handler = entry.mask[key];
      if (typeof handler !== 'function') {
        throw new Error('[TelemetryEventSchemaRegistry] `mask` entries must be functions.');
      }
    }
  }

  return entry;
}

function applyDefaults(payload, defaults) {
  if (!defaults) return payload;
  const next = { ...defaults };
  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        next[key] = value;
      }
    }
  }
  return next;
}

function applyRedactions(payload, fields = []) {
  if (!payload || typeof payload !== 'object' || !fields.length) {
    return payload;
  }
  const next = { ...payload };
  for (const field of fields) {
    if (field in next) {
      delete next[field];
    }
  }
  return next;
}

function applyMasks(payload, mask = null, context = {}) {
  if (!payload || typeof payload !== 'object' || !mask) {
    return payload;
  }
  const next = { ...payload };
  for (const [field, handler] of Object.entries(mask)) {
    if (field in next) {
      try {
        next[field] = handler(next[field], context);
      } catch (error) {
        console?.warn?.('[TelemetryEventSchemaRegistry] mask handler failed', error);
        delete next[field];
      }
    }
  }
  return next;
}

export class TelemetryEventSchemaRegistry {
  constructor(options = {}) {
    this.defaultClassification = options.defaultClassification || 'analytics';
    this.defaultRetention = options.defaultRetention || 'session';
    this.schemas = [];
  }

  register(schema) {
    const normalized = normalizeSchema(schema);
    this.schemas.push(normalized);
    this.schemas.sort((a, b) => b.priority - a.priority);
    return () => {
      const index = this.schemas.indexOf(normalized);
      if (index >= 0) {
        this.schemas.splice(index, 1);
      }
    };
  }

  resolve(eventName) {
    if (!eventName) return null;

    for (const schema of this.schemas) {
      if (schema.id && schema.id === eventName) {
        return schema;
      }
    }

    const prefixMatches = this.schemas.filter(schema => schema.prefix && eventName.startsWith(schema.prefix));
    if (prefixMatches.length > 0) {
      prefixMatches.sort((a, b) => {
        if (a.prefix === b.prefix) {
          return b.priority - a.priority;
        }
        return b.prefix.length - a.prefix.length;
      });
      return prefixMatches[0];
    }

    for (const schema of this.schemas) {
      if (schema.match && schema.match.test(eventName)) {
        return schema;
      }
    }

    return null;
  }

  evaluate(eventName, payload = {}, context = {}) {
    const schema = this.resolve(eventName);
    let resultPayload = payload && typeof payload === 'object' ? { ...payload } : payload;
    let classification = context.classificationOverride || this.defaultClassification;
    let requiresConsent = undefined;
    let retention = this.defaultRetention;
    let metadata;

    if (schema) {
      classification = schema.classification || classification;
      retention = schema.retention || retention;
      resultPayload = applyDefaults(resultPayload, schema.defaults);
      resultPayload = applyRedactions(resultPayload, schema.redact);
      resultPayload = applyMasks(resultPayload, schema.mask, context);

      if (schema.transform) {
        try {
          const transformed = schema.transform(resultPayload, context);
          if (transformed !== undefined) {
            resultPayload = transformed;
          }
        } catch (error) {
          return {
            allowed: false,
            reason: 'transform-error',
            error,
            classification,
            payload: null,
            schema
          };
        }
      }

      if (schema.validate) {
        try {
          const validationResult = schema.validate(resultPayload, context);
          if (validationResult === false) {
            return {
              allowed: false,
              reason: 'validation-failed',
              classification,
              payload: null,
              schema
            };
          }
          if (validationResult && typeof validationResult === 'object') {
            if (validationResult.allowed === false) {
              return {
                allowed: false,
                reason: validationResult.reason || 'validation-failed',
                classification,
                payload: null,
                schema
              };
            }
            if (validationResult.payload && typeof validationResult.payload === 'object') {
              resultPayload = validationResult.payload;
            }
            if (validationResult.metadata) {
              metadata = validationResult.metadata;
            }
          }
        } catch (error) {
          return {
            allowed: false,
            reason: 'validation-error',
            error,
            classification,
            payload: null,
            schema
          };
        }
      }

      requiresConsent = schema.requiresConsent;
      if (schema.metadata) {
        metadata = { ...(metadata || {}), ...schema.metadata };
      }
    }

    if (requiresConsent === undefined) {
      requiresConsent = DEFAULT_REQUIRES_CONSENT.has(classification);
    }

    return {
      allowed: true,
      classification,
      payload: resultPayload,
      requiresConsent,
      retention,
      schema,
      metadata
    };
  }
}
