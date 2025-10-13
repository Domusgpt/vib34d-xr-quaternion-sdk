const DEFAULT_BUFFER_COUNT = 3;
const DEFAULT_SAFETY_OFFSET = 1;

function resolveUsageOverride(usage) {
  if (typeof usage === 'number') {
    return usage;
  }

  if (typeof GPUBufferUsage !== 'undefined') {
    return GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  }

  return 0;
}

function ensureDevice(device) {
  if (!device || typeof device.createBuffer !== 'function') {
    throw new Error('TripleBufferedUniform requires a valid GPU device with createBuffer.');
  }
  return device;
}

function ensureQueue(device, queue) {
  const targetQueue = queue || device.queue;
  if (!targetQueue || typeof targetQueue.writeBuffer !== 'function') {
    throw new Error('TripleBufferedUniform requires a GPU queue with writeBuffer.');
  }
  return targetQueue;
}

function ensureBindGroupFactory(device) {
  if (typeof device.createBindGroup !== 'function') {
    return null;
  }
  return (descriptor) => device.createBindGroup(descriptor);
}

export class TripleBufferedUniform {
  constructor(device, size, options = {}) {
    this.device = ensureDevice(device);
    this.size = Math.max(0, Number(size) || 0);

    if (this.size <= 0) {
      throw new Error('TripleBufferedUniform requires a uniform size greater than zero.');
    }

    const {
      label = 'triple-uniform',
      bufferCount = DEFAULT_BUFFER_COUNT,
      safetyOffset = DEFAULT_SAFETY_OFFSET,
      usage,
      queue,
    } = options;

    this.label = label;
    this.bufferCount = Math.max(DEFAULT_BUFFER_COUNT, Math.floor(bufferCount));
    this.safetyOffset = Math.max(0, Math.floor(safetyOffset));
    this.usage = resolveUsageOverride(usage);
    this.queue = ensureQueue(this.device, queue);
    this.createBindGroup = ensureBindGroupFactory(this.device);

    this.buffers = Array.from({ length: this.bufferCount }, (_, index) => {
      return this.device.createBuffer({
        size: this.size,
        usage: this.usage,
        label: `${this.label}[${index}]`,
      });
    });

    this.currentIndex = 0;
    this.lastSubmittedIndex = null;
  }

  update(deviceOrData, maybeData, maybeOffset) {
    const hasExplicitDevice = typeof deviceOrData === 'object' &&
      deviceOrData !== null &&
      typeof deviceOrData.createBuffer === 'function';

    const device = hasExplicitDevice ? ensureDevice(deviceOrData) : this.device;
    const data = hasExplicitDevice ? maybeData : deviceOrData;
    const offset = hasExplicitDevice ? (maybeOffset || 0) : (maybeData || 0);

    if (!data) {
      throw new Error('TripleBufferedUniform.update requires data to upload.');
    }

    const queue = ensureQueue(device, this.queue);
    const buffer = this.buffers[this.currentIndex];

    queue.writeBuffer(buffer, offset, data.buffer ? data : new Uint8Array(data));

    this.lastSubmittedIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % this.buffers.length;
  }

  getReadableBuffer() {
    const index = this.getReadableIndex();
    return this.buffers[index];
  }

  getReadableIndex() {
    if (this.lastSubmittedIndex === null) {
      return 0;
    }

    const offset = Math.min(this.safetyOffset, this.buffers.length - 1);
    return (this.lastSubmittedIndex - offset + this.buffers.length) % this.buffers.length;
  }

  createBindGroupForLayout(layout, binding = 0, additionalEntries = []) {
    if (!this.createBindGroup) {
      throw new Error('Device does not support bind group creation in this context.');
    }

    const buffer = this.getReadableBuffer();
    return this.createBindGroup({
      layout,
      entries: [
        {
          binding,
          resource: { buffer },
        },
        ...additionalEntries,
      ],
    });
  }
}

export default TripleBufferedUniform;
