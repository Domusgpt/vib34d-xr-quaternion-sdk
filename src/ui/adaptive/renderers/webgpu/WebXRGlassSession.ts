import GlassUniformController from './GlassUniformController.ts';
import type { AudioBands, VisualParameterVector, XRFrameLike, XRViewLike, XRViewerPoseLike } from './WebXRQuaternionBridge.ts';
import { MultiLayerGlassComposer } from './MultiLayerGlassComposer.ts';
import {
  createGlassPipelines,
  createLayerParameterResources,
  type GlassPipelineResources,
} from './GlassPipelineFactory.ts';
import LayerBlurHelper from './LayerBlurHelper.ts';
import {
  GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
  GPU_TEXTURE_USAGE_TEXTURE_BINDING,
  type GPUBufferLike,
  type GPUDeviceRaw,
  type GPUTextureRaw,
} from './GPUInterfaces.ts';

interface XRSystemLike {
  requestSession(mode: string, options?: unknown): Promise<XRSessionLike>;
}

interface XRReferenceSpaceLike {}

type XRFrameRequestCallbackLike = (time: number, frame: XRFrameLike) => void;

interface XRSessionLike {
  requestReferenceSpace(type: string): Promise<XRReferenceSpaceLike>;
  requestAnimationFrame(callback: XRFrameRequestCallbackLike): number;
  cancelAnimationFrame?(handle: number): void;
  updateRenderState(state: Record<string, unknown>): void;
  end(): Promise<void>;
}

interface XRProjectionLayerLike {
  readonly textureWidth?: number;
  readonly textureHeight?: number;
}

interface XRViewportLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface XRViewSubImageLike {
  readonly colorTexture: GPUTextureRaw;
  readonly depthStencilTexture?: GPUTextureRaw;
  readonly viewport?: XRViewportLike;
  readonly textureWidth?: number;
  readonly textureHeight?: number;
  getViewDescriptor?: () => Record<string, unknown>;
}

interface XRGPUBindingLike {
  getPreferredColorFormat?(): string;
  createProjectionLayer(options: Record<string, unknown>): XRProjectionLayerLike;
  getViewSubImage(layer: XRProjectionLayerLike, view: XRViewLike): XRViewSubImageLike;
}

export interface WebXRGlassSessionOptions {
  readonly device: GPUDeviceRaw;
  readonly composer: MultiLayerGlassComposer;
  readonly controller: GlassUniformController;
  readonly xr?: XRSystemLike | null;
  readonly logger?: { warn?: (...args: unknown[]) => void };
  readonly sessionMode?: string;
  readonly referenceSpaceType?: string;
  readonly sessionInit?: Record<string, unknown>;
  readonly colorFormat?: string;
  readonly depthFormat?: string;
  readonly bindingFactory?: (session: XRSessionLike, device: GPUDeviceRaw) => XRGPUBindingLike;
  readonly onFrame?: (info: { fps: number }) => void;
  readonly audioOverride?: Partial<AudioBands>;
  readonly visualOverride?: Partial<VisualParameterVector>;
}

interface ViewTargets {
  width: number;
  height: number;
  textures: GPUTextureRaw[];
  views: unknown[];
  finalViews: unknown[];
  compositeBindGroup: unknown;
  blurHelper: LayerBlurHelper | null;
}

export class WebXRGlassSession {
  private readonly device: GPUDeviceRaw;
  private readonly composer: MultiLayerGlassComposer;
  private readonly controller: GlassUniformController;
  private readonly xrSystem?: XRSystemLike | null;
  private readonly logger?: { warn?: (...args: unknown[]) => void };
  private readonly sessionMode: string;
  private readonly referenceSpaceType: string;
  private readonly sessionInit: Record<string, unknown> | undefined;
  private readonly depthFormat: string;
  private readonly bindingFactory?: (session: XRSessionLike, device: GPUDeviceRaw) => XRGPUBindingLike;
  private readonly onFrame?: (info: { fps: number }) => void;
  private readonly audioOverride?: Partial<AudioBands>;
  private readonly visualOverride?: Partial<VisualParameterVector>;

  private pipelines: GlassPipelineResources | null = null;
  private layerUniformBuffers: GPUBufferLike[] = [];
  private layerBindGroups: unknown[] = [];
  private layerParameterData: Float32Array[] = [];
  private colorFormat: string | null = null;

  private session: XRSessionLike | null = null;
  private referenceSpace: XRReferenceSpaceLike | null = null;
  private binding: XRGPUBindingLike | null = null;
  private projectionLayer: XRProjectionLayerLike | null = null;
  private rafHandle: number | null = null;
  private running = false;
  private lastFrameSeconds: number | null = null;
  private fpsAccumulator = 0;
  private fpsFrames = 0;

  private readonly viewTargets = new Map<number, ViewTargets>();
  private readonly hasBlurLayers: boolean;

  constructor(options: WebXRGlassSessionOptions) {
    if (!options?.device) {
      throw new Error('WebXRGlassSession requires a WebGPU device');
    }
    if (!options?.composer) {
      throw new Error('WebXRGlassSession requires a MultiLayerGlassComposer instance');
    }
    if (!options?.controller) {
      throw new Error('WebXRGlassSession requires a GlassUniformController instance');
    }

    this.device = options.device;
    this.composer = options.composer;
    this.controller = options.controller;
    this.xrSystem = options.xr;
    this.logger = options.logger;
    this.sessionMode = options.sessionMode ?? 'immersive-vr';
    this.referenceSpaceType = options.referenceSpaceType ?? 'local-floor';
    this.sessionInit = options.sessionInit;
    this.colorFormat = options.colorFormat ?? null;
    this.depthFormat = options.depthFormat ?? 'depth24plus';
    this.bindingFactory = options.bindingFactory;
    this.onFrame = options.onFrame;
    this.audioOverride = options.audioOverride;
    this.visualOverride = options.visualOverride;
    this.hasBlurLayers = this.composer.layers.some(layer => (layer.blurRadius ?? 0) > 0);
  }

  get runningSession(): XRSessionLike | null {
    return this.session;
  }

  listRisks(): string[] {
    return [
      ...this.composer.summarizeRisks(),
      ...(typeof this.controller.listLocalizationRisks === 'function'
        ? this.controller.listLocalizationRisks()
        : []),
    ];
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    const xrSystem = this.xrSystem ?? (typeof navigator !== 'undefined' ? (navigator as Navigator & { xr?: XRSystemLike }).xr : null);
    if (!xrSystem?.requestSession) {
      throw new Error('WebXR not available or requestSession missing');
    }

    const session = await xrSystem.requestSession(this.sessionMode, this.sessionInit);
    this.session = session;
    this.referenceSpace = await session.requestReferenceSpace(this.referenceSpaceType);

    const binding = this.bindingFactory?.(session, this.device) ?? this.createDefaultBinding(session);
    if (!binding) {
      throw new Error('Failed to create XRGPUBinding for WebXRGlassSession');
    }
    this.binding = binding;

    const colorFormat = this.colorFormat ?? binding.getPreferredColorFormat?.() ?? 'bgra8unorm';
    this.colorFormat = colorFormat;

    this.pipelines = createGlassPipelines({
      device: this.device,
      composer: this.composer,
      layers: this.composer.layers,
      outputFormat: colorFormat,
    });

    const layerParams = createLayerParameterResources(this.device, this.composer.layers, this.pipelines.layerBindGroupLayout);
    this.layerUniformBuffers = layerParams.buffers;
    this.layerBindGroups = layerParams.bindGroups;
    this.layerParameterData = layerParams.data;

    const projectionLayer = binding.createProjectionLayer({
      colorFormat,
      depthStencilFormat: this.depthFormat,
      textureUsage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT | GPU_TEXTURE_USAGE_TEXTURE_BINDING,
    });
    this.projectionLayer = projectionLayer;

    session.updateRenderState({ layers: [projectionLayer] });

    this.running = true;
    this.lastFrameSeconds = null;
    this.scheduleFrame();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;

    if (this.session) {
      if (this.rafHandle != null && typeof this.session.cancelAnimationFrame === 'function') {
        this.session.cancelAnimationFrame(this.rafHandle);
      }
      this.rafHandle = null;
      try {
        await this.session.end();
      } catch (error) {
        this.logger?.warn?.('[WebXRGlassSession] Failed to end XR session', error);
      }
    }
    this.session = null;
    this.referenceSpace = null;
    this.binding = null;
    this.projectionLayer = null;
    this.viewTargets.forEach(entry => this.disposeViewTargets(entry));
    this.viewTargets.clear();
  }

  async dispose(): Promise<void> {
    await this.stop();
    for (const buffer of this.layerUniformBuffers) {
      (buffer as { destroy?: () => void })?.destroy?.();
    }
    this.layerUniformBuffers = [];
  }

  private scheduleFrame(): void {
    if (!this.session) {
      return;
    }
    this.rafHandle = this.session.requestAnimationFrame(this.handleXRFrame);
  }

  private readonly handleXRFrame = (timestamp: number, frame: XRFrameLike): void => {
    if (!this.running || !this.session || !this.binding || !this.referenceSpace) {
      return;
    }

    const pose = frame.getViewerPose(this.referenceSpace);
    if (!pose) {
      this.scheduleFrame();
      return;
    }

    const seconds = timestamp * 0.001;
    const delta = this.lastFrameSeconds == null ? 0 : seconds - this.lastFrameSeconds;
    this.lastFrameSeconds = seconds;

    try {
      this.controller.update(frame, {
        referenceSpace: this.referenceSpace,
        frameTime: seconds,
        deltaTime: delta,
        audioOverride: this.audioOverride,
        visualOverride: this.visualOverride,
      });
    } catch (error) {
      this.logger?.warn?.('[WebXRGlassSession] Failed to update uniforms', error);
      this.scheduleFrame();
      return;
    }

    try {
      this.renderPose(frame, pose, seconds, delta);
      this.updateFps(delta);
    } catch (error) {
      this.logger?.warn?.('[WebXRGlassSession] Failed to render XR frame', error);
    }

    this.scheduleFrame();
  };

  private renderPose(frame: XRFrameLike, pose: XRViewerPoseLike, frameTime: number, deltaTime: number): void {
    if (!this.pipelines || !this.binding || !this.projectionLayer) {
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'GlassXRFrame' });
    const globalBindGroup = this.device.createBindGroup({
      layout: this.pipelines.uniformBindGroupLayout,
      entries: [this.composer.getUniformBindGroupEntry(0)],
    });

    pose.views.forEach((view, viewIndex) => {
      const subImage = this.binding!.getViewSubImage(this.projectionLayer!, view);
      const viewport = subImage.viewport;
      const width = Math.max(1, Math.floor(subImage.textureWidth ?? viewport?.width ?? this.composer.target.width));
      const height = Math.max(1, Math.floor(subImage.textureHeight ?? viewport?.height ?? this.composer.target.height));
      const targets = this.ensureViewTargets(viewIndex, width, height);

      this.composer.layers.forEach((layer, layerIndex) => {
        const pass = encoder.beginRenderPass({
          label: `XRLayer-${layer.name}`,
          colorAttachments: [
            {
              view: targets.views[layerIndex],
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        const pipeline = this.pipelines!.layerPipelines[layerIndex] ?? this.pipelines!.layerPipelines[0];
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, globalBindGroup);
        pass.setBindGroup(1, this.layerBindGroups[layerIndex]);
        pass.draw(3, 1, 0, 0);
        pass.end();

        const blurredView = targets.blurHelper?.encodeBlur(
          encoder,
          layerIndex,
          targets.views[layerIndex],
          width,
          height
        ) ?? targets.views[layerIndex];
        targets.finalViews[layerIndex] = blurredView;
      });

      targets.compositeBindGroup = this.device.createBindGroup({
        layout: this.pipelines!.compositeBindGroupLayout,
        entries: [
          { binding: 0, resource: this.pipelines!.sampler },
          ...targets.finalViews.map((view, index) => ({ binding: index + 1, resource: view })),
        ],
      });

      const colorView = subImage.colorTexture.createView(subImage.getViewDescriptor?.());
      const compositePass = encoder.beginRenderPass({
        label: `XRComposite-${viewIndex}`,
        colorAttachments: [
          {
            view: colorView,
            clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      if (viewport && typeof compositePass.setViewport === 'function') {
        compositePass.setViewport(
          viewport.x,
          viewport.y,
          viewport.width,
          viewport.height,
          0,
          1,
        );
      }

      compositePass.setPipeline(this.pipelines!.compositePipeline);
      compositePass.setBindGroup(0, globalBindGroup);
      compositePass.setBindGroup(1, targets.compositeBindGroup);
      compositePass.draw(3, 1, 0, 0);
      compositePass.end();
    });

    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);
  }

  private ensureViewTargets(viewIndex: number, width: number, height: number): ViewTargets {
    const existing = this.viewTargets.get(viewIndex);
    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    if (existing) {
      this.disposeViewTargets(existing);
    }

    const textures = this.composer.layers.map((layer, layerIndex) =>
      this.device.createTexture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: this.composer.target.format ?? 'rgba16float',
        usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT | GPU_TEXTURE_USAGE_TEXTURE_BINDING,
        label: `${layer.name}-View${viewIndex}-Layer${layerIndex}`,
      })
    );

    const views = textures.map(texture => texture.createView());
    const blurHelper = this.hasBlurLayers
      ? new LayerBlurHelper({
        device: this.device,
        layers: this.composer.layers,
        sampler: this.pipelines!.sampler,
        format: this.composer.target.format ?? 'rgba16float',
      })
      : null;

    blurHelper?.resize(width, height);
    const finalViews = views.map((view, index) => blurHelper?.getCompositeView(index, view) ?? view);

    const compositeBindGroup = this.device.createBindGroup({
      layout: this.pipelines!.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: this.pipelines!.sampler },
        ...finalViews.map((view, index) => ({ binding: index + 1, resource: view })),
      ],
    });

    const entry: ViewTargets = { width, height, textures, views, finalViews, compositeBindGroup, blurHelper };
    this.viewTargets.set(viewIndex, entry);
    return entry;
  }

  private disposeViewTargets(entry: ViewTargets): void {
    entry.textures.forEach(texture => {
      try {
        texture.destroy?.();
      } catch (error) {
        this.logger?.warn?.('[WebXRGlassSession] Failed to destroy texture', error);
      }
    });
    entry.blurHelper?.dispose();
  }

  private createDefaultBinding(session: XRSessionLike): XRGPUBindingLike | null {
    const ctor = (globalThis as typeof globalThis & { XRGPUBinding?: new (session: XRSessionLike, device: GPUDeviceRaw) => XRGPUBindingLike }).XRGPUBinding;
    if (!ctor) {
      return null;
    }
    try {
      return new ctor(session, this.device);
    } catch (error) {
      this.logger?.warn?.('[WebXRGlassSession] Failed to construct XRGPUBinding', error);
      return null;
    }
  }

  private updateFps(deltaTime: number): void {
    if (!this.onFrame || deltaTime <= 0) {
      return;
    }
    this.fpsAccumulator += deltaTime;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      const fps = this.fpsFrames / this.fpsAccumulator;
      this.onFrame({ fps });
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
  }
}

export default WebXRGlassSession;
