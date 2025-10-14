const DEFAULT_COLOR_FORMATS = ['rgba16float'];

function ensureDevice(device) {
  if (!device || typeof device.createRenderBundleEncoder !== 'function') {
    throw new Error('WebGPURenderBundleCache requires a device with createRenderBundleEncoder support.');
  }
  return device;
}

export class WebGPURenderBundleCache {
  constructor(device, options = {}) {
    this.device = ensureDevice(device);
    this.label = options.label || 'webgpu-render-bundle-cache';
    this.defaultColorFormats = Array.isArray(options.colorFormats) && options.colorFormats.length > 0
      ? options.colorFormats
      : DEFAULT_COLOR_FORMATS;

    this.cache = new Map();
  }

  makeKey(parts = []) {
    return parts.join('::');
  }

  get(key) {
    return this.cache.get(key)?.bundle || null;
  }

  record(keyParts, descriptor, recordFn) {
    const key = this.makeKey(keyParts);
    const existing = this.cache.get(key);
    if (existing?.bundle) {
      return existing.bundle;
    }

    const encoderDescriptor = {
      label: `${this.label}-${key}`,
      colorFormats: descriptor?.colorFormats || this.defaultColorFormats,
      depthStencilFormat: descriptor?.depthStencilFormat,
    };

    const encoder = this.device.createRenderBundleEncoder(encoderDescriptor);
    recordFn(encoder);
    const bundle = encoder.finish();

    this.cache.set(key, {
      descriptor: encoderDescriptor,
      bundle,
    });

    return bundle;
  }

  invalidate(keyParts) {
    const key = this.makeKey(keyParts);
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

export default WebGPURenderBundleCache;
