import { normalizeQuaternionObject, dualQuaternionToPose } from '../../../../core/quaternion/index.js';

const DEFAULT_SMOOTHING = 0.8;
const DEFAULT_MOTION_GAIN = 1;
const EPSILON = 1e-6;

function clamp01(value) {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function toVector3(position) {
  if (!position) {
    return [0, 0, 0];
  }
  if (Array.isArray(position) || ArrayBuffer.isView(position)) {
    return [Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0];
  }
  if (typeof position === 'object') {
    return [Number(position.x) || 0, Number(position.y) || 0, Number(position.z) || 0];
  }
  return [0, 0, 0];
}

function toQuaternion(value) {
  if (!value) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return normalizeQuaternionObject({
      x: Number(value[0]) || 0,
      y: Number(value[1]) || 0,
      z: Number(value[2]) || 0,
      w: Number(value[3]) || 1,
    });
  }
  if (typeof value === 'object') {
    return normalizeQuaternionObject({
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
      z: Number(value.z) || 0,
      w: Number(value.w) || 1,
    });
  }
  return { x: 0, y: 0, z: 0, w: 1 };
}

function dotQuaternion(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export class WebGPUXRFrameLoop {
  constructor(options = {}) {
    const {
      device,
      session,
      pipeline,
      referenceSpace = null,
      logger = console,
      viewProvider = null,
      xrBinding = null,
      bindingFactory = null,
      projectionLayer = null,
      projectionLayerInit = {},
      commandEncoderFactory = null,
      motionEnergySmoothing = DEFAULT_SMOOTHING,
      motionEnergyGain = DEFAULT_MOTION_GAIN,
      audioAnalyzer = null,
      audioBinCount = null,
      beforeSubmit = null,
      autoResize = true,
    } = options;

    if (!device || typeof device.createCommandEncoder !== 'function') {
      throw new Error('WebGPUXRFrameLoop requires a GPU device with createCommandEncoder support.');
    }
    if (!device.queue || typeof device.queue.submit !== 'function') {
      throw new Error('WebGPUXRFrameLoop requires a GPU device queue capable of submit.');
    }
    if (!session || typeof session.requestAnimationFrame !== 'function') {
      throw new Error('WebGPUXRFrameLoop requires an XRSession with requestAnimationFrame.');
    }
    if (!pipeline || typeof pipeline.updatePose !== 'function' || typeof pipeline.render !== 'function') {
      throw new Error('WebGPUXRFrameLoop requires a WebGPUGlassmorphicPipeline instance.');
    }

    this.device = device;
    this.session = session;
    this.pipeline = pipeline;
    this.referenceSpace = referenceSpace;
    this.logger = logger;

    this.viewProvider = null;
    if (viewProvider) {
      this.setViewProvider(viewProvider);
    }

    this.xrBinding = xrBinding || null;
    this.bindingFactory = typeof bindingFactory === 'function' ? bindingFactory : null;
    this.projectionLayer = projectionLayer || null;
    this.projectionLayerInit = projectionLayerInit || {};

    this.motionEnergySmoothing = clamp01(motionEnergySmoothing ?? DEFAULT_SMOOTHING);
    this.motionEnergyGain = typeof motionEnergyGain === 'number' ? motionEnergyGain : DEFAULT_MOTION_GAIN;

    this.commandEncoderFactory = typeof commandEncoderFactory === 'function'
      ? commandEncoderFactory
      : (options) => device.createCommandEncoder({ label: options?.label ?? 'webgpu-xr-frame' });

    this.beforeSubmit = typeof beforeSubmit === 'function' ? beforeSubmit : null;

    this.audioAnalyzer = audioAnalyzer || null;
    this.audioBinCountOverride = typeof audioBinCount === 'number' ? Math.max(1, Math.floor(audioBinCount)) : null;
    this.audioFloatBuffer = null;
    this.audioByteBuffer = null;

    this.autoResize = autoResize !== false;
    this.cachedPipelineSize = typeof pipeline.getSize === 'function' ? pipeline.getSize() : null;
    this.lastFinalColorFormat = typeof pipeline.getFinalColorFormat === 'function'
      ? pipeline.getFinalColorFormat()
      : null;

    this.boundFrame = this.handleXRFrame.bind(this);
    this.running = false;
    this.frameHandle = null;

    this.lastQuaternion = null;
    this.lastTimestamp = null;
    this.smoothedMotionEnergy = 0;
  }

  static createBindingViewProvider(binding, projectionLayer, options = {}) {
    if (!binding || typeof binding.getViewSubImage !== 'function') {
      throw new Error('Binding view provider requires an XRGPUBinding with getViewSubImage.');
    }
    if (!projectionLayer) {
      throw new Error('Binding view provider requires a projection layer.');
    }

    const colorFormat = options.colorFormat || (typeof binding.getPreferredColorFormat === 'function'
      ? binding.getPreferredColorFormat()
      : null);

    return (frame, view) => {
      const subImage = binding.getViewSubImage(projectionLayer, view);
      if (!subImage || !subImage.colorTexture || typeof subImage.colorTexture.createView !== 'function') {
        return null;
      }
      const descriptor = typeof subImage.getViewDescriptor === 'function'
        ? subImage.getViewDescriptor()
        : undefined;
      const colorView = subImage.colorTexture.createView(descriptor);
      const depthView = subImage.depthStencilTexture && typeof subImage.depthStencilTexture.createView === 'function'
        ? subImage.depthStencilTexture.createView(descriptor)
        : null;
      const viewport = subImage.viewport || null;
      const width = Math.max(0, Math.floor(viewport?.width ?? subImage.textureWidth ?? 0));
      const height = Math.max(0, Math.floor(viewport?.height ?? subImage.textureHeight ?? 0));

      return {
        colorView,
        depthView,
        finalColorFormat: colorFormat,
        viewport,
        size: width && height ? { width, height } : undefined,
        width: width || undefined,
        height: height || undefined,
      };
    };
  }

  setViewProvider(provider) {
    if (provider == null) {
      this.viewProvider = null;
      return;
    }
    if (typeof provider !== 'function') {
      throw new Error('viewProvider must be a function or null.');
    }
    this.viewProvider = (frame, view) => provider(frame, view, {
      device: this.device,
      session: this.session,
      pipeline: this.pipeline,
      referenceSpace: this.referenceSpace,
    });
  }

  setReferenceSpace(referenceSpace) {
    this.referenceSpace = referenceSpace;
  }

  setAudioAnalyzer(analyzer, options = {}) {
    this.audioAnalyzer = analyzer || null;
    this.audioFloatBuffer = null;
    this.audioByteBuffer = null;
    if (options && typeof options.binCount === 'number') {
      this.audioBinCountOverride = Math.max(1, Math.floor(options.binCount));
    }
  }

  setXRBinding(binding, projectionLayer = null, options = {}) {
    this.xrBinding = binding || null;
    if (projectionLayer) {
      this.projectionLayer = projectionLayer;
    }
    if (options && typeof options.projectionLayerInit === 'object') {
      this.projectionLayerInit = options.projectionLayerInit;
    }
    if (binding && projectionLayer) {
      try {
        const viewProvider = WebGPUXRFrameLoop.createBindingViewProvider(binding, projectionLayer, options);
        this.setViewProvider(viewProvider);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] Failed to create view provider from binding', error);
      }
    }
  }

  start(options = {}) {
    if (this.running) {
      return this;
    }
    if (!this.referenceSpace && !options.referenceSpace) {
      throw new Error('WebGPUXRFrameLoop requires a reference space to start.');
    }
    if (options.referenceSpace) {
      this.referenceSpace = options.referenceSpace;
    }

    this.ensureViewProvider();

    this.running = true;
    this.scheduleNextFrame();
    return this;
  }

  stop() {
    if (!this.running) {
      return;
    }
    if (this.frameHandle != null && typeof this.session.cancelAnimationFrame === 'function') {
      try {
        this.session.cancelAnimationFrame(this.frameHandle);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] cancelAnimationFrame failed', error);
      }
    }
    this.frameHandle = null;
    this.running = false;
  }

  ensureViewProvider() {
    if (this.viewProvider) {
      return;
    }

    if (!this.xrBinding && this.bindingFactory) {
      try {
        this.xrBinding = this.bindingFactory(this.session, this.device);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] bindingFactory failed', error);
      }
    }

    if (!this.xrBinding && typeof XRGPUBinding === 'function') {
      try {
        this.xrBinding = new XRGPUBinding(this.session, this.device);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] XRGPUBinding construction failed', error);
      }
    }

    if (!this.projectionLayer && this.xrBinding && typeof this.xrBinding.createProjectionLayer === 'function') {
      try {
        const init = { ...this.projectionLayerInit };
        if (!init.colorFormat && typeof this.xrBinding.getPreferredColorFormat === 'function') {
          init.colorFormat = this.xrBinding.getPreferredColorFormat();
        }
        this.projectionLayer = this.xrBinding.createProjectionLayer(init);
        if (typeof this.session.updateRenderState === 'function') {
          this.session.updateRenderState({ layers: [this.projectionLayer] });
        }
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] Failed to create projection layer', error);
      }
    }

    if (this.xrBinding && this.projectionLayer) {
      try {
        const provider = WebGPUXRFrameLoop.createBindingViewProvider(this.xrBinding, this.projectionLayer, this.projectionLayerInit);
        this.setViewProvider(provider);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] Failed to initialize view provider', error);
      }
    }
  }

  scheduleNextFrame() {
    try {
      this.frameHandle = this.session.requestAnimationFrame(this.boundFrame);
    } catch (error) {
      this.logger?.warn?.('[WebGPUXRFrameLoop] requestAnimationFrame failed', error);
      this.frameHandle = null;
    }
  }

  handleXRFrame(time, frame) {
    if (!this.running) {
      return;
    }

    this.scheduleNextFrame();

    const pose = frame?.getViewerPose?.(this.referenceSpace);
    if (!pose) {
      return;
    }

    const transform = pose.transform || {};

    let orientation;
    let position;
    let dualQuaternion = null;

    if (transform.dualQuaternion) {
      const dualPose = dualQuaternionToPose(transform.dualQuaternion);
      orientation = normalizeQuaternionObject(dualPose.orientation);
      position = dualPose.position;
      dualQuaternion = dualPose.normalized;
    } else {
      orientation = toQuaternion(transform.orientation);
      position = toVector3(transform.position);
    }

    const timestamp = typeof time === 'number' ? time : (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();

    const motionEnergy = this.computeMotionEnergy(orientation, timestamp);

    const posePayload = { orientation, position };
    if (dualQuaternion) {
      posePayload.dualQuaternion = dualQuaternion;
    }

    try {
      this.pipeline.updatePose(posePayload, { timestamp, motionEnergy });
    } catch (error) {
      this.logger?.warn?.('[WebGPUXRFrameLoop] pipeline.updatePose failed', error);
    }

    try {
      this.updateAudio();
    } catch (error) {
      this.logger?.warn?.('[WebGPUXRFrameLoop] updateAudio failed', error);
    }

    const commandEncoder = this.commandEncoderFactory({ frame, label: 'webgpu-xr-frame' });
    if (!commandEncoder || typeof commandEncoder.finish !== 'function') {
      this.logger?.warn?.('[WebGPUXRFrameLoop] commandEncoderFactory did not return a valid encoder');
      return;
    }

    const views = Array.isArray(pose.views) ? pose.views : [];
    for (const view of views) {
      const target = this.viewProvider ? this.viewProvider(frame, view) : null;
      if (!target || !target.colorView) {
        continue;
      }
      try {
        this.updatePipelineTargetMetadata(target);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] updatePipelineTargetMetadata failed', error);
      }
      try {
        this.pipeline.render(commandEncoder, target.colorView, { finalColorFormat: target.finalColorFormat });
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] pipeline.render failed', error);
      }
    }

    if (this.beforeSubmit) {
      try {
        this.beforeSubmit({ frame, pose, encoder: commandEncoder });
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] beforeSubmit hook failed', error);
      }
    }

    const commandBuffer = commandEncoder.finish();
    if (commandBuffer) {
      try {
        this.device.queue.submit([commandBuffer]);
      } catch (error) {
        this.logger?.warn?.('[WebGPUXRFrameLoop] queue.submit failed', error);
      }
    }
  }

  computeMotionEnergy(quaternion, timestamp) {
    const normalized = normalizeQuaternionObject(quaternion);
    if (!this.lastQuaternion) {
      this.lastQuaternion = normalized;
      this.lastTimestamp = timestamp;
      this.smoothedMotionEnergy = 0;
      return 0;
    }

    const dt = Math.max(EPSILON, (timestamp - (this.lastTimestamp ?? timestamp)) / 1000);
    const dot = Math.min(1, Math.max(-1, dotQuaternion(this.lastQuaternion, normalized)));
    const angle = 2 * Math.acos(Math.abs(dot));
    const energy = (angle / dt) * this.motionEnergyGain;

    this.smoothedMotionEnergy = (this.smoothedMotionEnergy * this.motionEnergySmoothing)
      + (energy * (1 - this.motionEnergySmoothing));

    this.lastQuaternion = normalized;
    this.lastTimestamp = timestamp;

    return this.smoothedMotionEnergy;
  }

  updateAudio() {
    if (!this.audioAnalyzer || typeof this.pipeline.updateAudio !== 'function') {
      return;
    }

    const binCount = this.audioBinCountOverride
      || Number(this.audioAnalyzer.frequencyBinCount)
      || this.audioFloatBuffer?.length
      || this.audioByteBuffer?.length
      || 0;

    if (binCount <= 0) {
      return;
    }

    if (typeof this.audioAnalyzer.getFloatFrequencyData === 'function') {
      if (!this.audioFloatBuffer || this.audioFloatBuffer.length !== binCount) {
        this.audioFloatBuffer = new Float32Array(binCount);
      }
      this.audioAnalyzer.getFloatFrequencyData(this.audioFloatBuffer);
      this.pipeline.updateAudio(this.audioFloatBuffer);
      return;
    }

    if (typeof this.audioAnalyzer.getByteFrequencyData === 'function') {
      if (!this.audioByteBuffer || this.audioByteBuffer.length !== binCount) {
        this.audioByteBuffer = new Uint8Array(binCount);
      }
      this.audioAnalyzer.getByteFrequencyData(this.audioByteBuffer);
      this.pipeline.updateAudio(this.audioByteBuffer);
    }
  }

  updatePipelineTargetMetadata(target) {
    if (!target || typeof target !== 'object') {
      return;
    }

    const format = target.finalColorFormat || target.colorFormat;
    if (format && typeof this.pipeline.setFinalColorFormat === 'function' && format !== this.lastFinalColorFormat) {
      this.pipeline.setFinalColorFormat(format);
      this.lastFinalColorFormat = format;
    }

    if (!this.autoResize || typeof this.pipeline.resize !== 'function') {
      return;
    }

    const size = target.size || target.viewport || target.dimensions || null;
    const widthSource = Number(size?.width ?? size?.[0] ?? target.width ?? target.textureWidth);
    const heightSource = Number(size?.height ?? size?.[1] ?? target.height ?? target.textureHeight);

    const width = Math.max(0, Math.floor(widthSource));
    const height = Math.max(0, Math.floor(heightSource));
    if (!width || !height) {
      return;
    }

    const currentSize = this.cachedPipelineSize || (typeof this.pipeline.getSize === 'function'
      ? this.pipeline.getSize()
      : null);

    if (!currentSize || currentSize.width !== width || currentSize.height !== height) {
      let resized = false;
      try {
        const result = this.pipeline.resize({ width, height });
        resized = result !== false;
      } finally {
        if (resized) {
          this.cachedPipelineSize = { width, height };
        }
      }
    }
  }
}

export default WebGPUXRFrameLoop;
