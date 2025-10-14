import { MultiLayerGlassComposer, type LayerDescriptor } from '../ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge, type AudioBands, type VisualParameterVector, type XRFrameLike } from '../ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import { normalize as normalizeQuaternionTuple, type Quaternion } from '../core/quaternion/index.ts';
import GlassUniformController from '../ui/adaptive/renderers/webgpu/GlassUniformController.ts';
import {
  createGlassPipelines,
  createLayerParameterResources,
} from '../ui/adaptive/renderers/webgpu/GlassPipelineFactory.ts';
import { buildGlassLayerShader, type GlassGeometryModule, type GlassProjectionModule } from '../ui/adaptive/renderers/webgpu/GlassShaderLibrary.ts';
import {
  GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
  GPU_TEXTURE_USAGE_TEXTURE_BINDING,
  type GPUDeviceRaw,
  type GPUTextureRaw,
  type GPUBufferLike,
} from '../ui/adaptive/renderers/webgpu/GPUInterfaces.ts';

const DEFAULT_LAYERS: LayerDescriptor[] = [
  {
    name: 'FrostedShell',
    pipelineLabel: 'LayerFrost',
    blurRadius: 7,
    shader: { geometry: 'hypersphere', projection: 'perspective' },
  },
  {
    name: 'Refraction',
    pipelineLabel: 'LayerRefraction',
    blurRadius: 5,
    shader: { geometry: 'hypercube', projection: 'orthographic' },
  },
  {
    name: 'GlyphVeil',
    pipelineLabel: 'LayerGlyph',
    shader: { geometry: 'hypertetrahedron', projection: 'stereographic' },
  },
  {
    name: 'ParticleHaze',
    pipelineLabel: 'LayerHaze',
    blurRadius: 3,
    shader: { geometry: 'hypercube', projection: 'perspective' },
  },
  {
    name: 'Highlights',
    pipelineLabel: 'LayerHighlights',
    shader: { geometry: 'hypersphere', projection: 'orthographic' },
  }
];

interface GPUAdapterLike {
  requestDevice(descriptor?: unknown): Promise<GPUDeviceRaw>;
}

interface NavigatorWebGPU {
  gpu?: {
    requestAdapter(options?: unknown): Promise<GPUAdapterLike | null>;
    getPreferredCanvasFormat?(): string;
  };
}

export interface WebGPUPreviewHarnessOptions {
  readonly canvas: HTMLCanvasElement;
  readonly layers?: LayerDescriptor[];
  readonly format?: string;
  readonly fovY?: number;
  readonly ipd?: number;
  readonly device?: GPUDeviceRaw;
  readonly context?: unknown;
  readonly onFrame?: (info: { fps: number }) => void;
  readonly geometry?: GlassGeometryModule;
  readonly projection?: GlassProjectionModule;
  readonly layerShaderCode?: string;
  readonly layerShaderCodes?: readonly string[];
}

type WebGPUPreviewHarnessInit = WebGPUPreviewHarnessOptions & {
  canvas: HTMLCanvasElement;
  device: GPUDeviceRaw;
  context: unknown;
  format: string;
  layers: LayerDescriptor[];
  layerShaderCode?: string;
  layerShaderCodes?: readonly string[];
};

interface PreviewState {
  quaternion: Quaternion;
  audio: Required<AudioBands>;
  confidence: number;
  visual: Required<VisualParameterVector>;
}

const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const defaultAudio = (): Required<AudioBands> => ({ bass: 0, mid: 0, high: 0, energy: 0 });

const defaultVisual = (): Required<VisualParameterVector> => ({
  dimension: 4,
  morphFactor: 0.5,
  rotationSpeed: 0.25,
  universeModifier: 1
});

const DEFAULT_FOVY = Math.PI / 2.2;
const DEFAULT_IPD = 0.062;

export function makePerspectiveMatrix(fovY: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fovY / 2);
  const rangeInv = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * rangeInv, -1,
    0, 0, 2 * far * near * rangeInv, 0
  ];
}

interface MockFrameOptions {
  readonly quaternion: Quaternion;
  readonly aspect: number;
  readonly fovY: number;
  readonly ipd: number;
  readonly position?: readonly [number, number, number];
}

const IDENTITY_MATRIX4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
] as const;

export function createMockXRFrame(options: MockFrameOptions): XRFrameLike {
  const projection = makePerspectiveMatrix(options.fovY, options.aspect, 0.1, 32);
  const orientation = {
    x: options.quaternion[0],
    y: options.quaternion[1],
    z: options.quaternion[2],
    w: options.quaternion[3]
  };
  const position = options.position ?? [0, 0, 0];
  const transform = {
    orientation,
    position: { x: position[0], y: position[1], z: position[2] },
    matrix: IDENTITY_MATRIX4,
    inverse: { matrix: IDENTITY_MATRIX4 }
  };

  const views = [
    { projectionMatrix: projection, transform },
    { projectionMatrix: projection, transform }
  ];

  const pose = { views, transform };
  return {
    getViewerPose: () => pose
  };
}

function computePreviewTranslation(time: number, audio: Required<AudioBands>): [number, number, number] {
  const amplitude = 0.35 + audio.energy * 0.25;
  const x = Math.sin(time * 0.45) * amplitude;
  const y = Math.cos(time * 0.38) * amplitude * 0.45 + (audio.mid - 0.5) * 0.3;
  const z = Math.cos(time * 0.32) * amplitude;
  return [x, y, z];
}

export class WebGPUPreviewHarness {
  static async create(options: WebGPUPreviewHarnessOptions): Promise<WebGPUPreviewHarness> {
    const canvas = options.canvas;
    if (!canvas) {
      throw new Error('WebGPUPreviewHarness requires a canvas element');
    }

    const navigatorWithGPU = (typeof navigator !== 'undefined' ? (navigator as Navigator & NavigatorWebGPU) : undefined);

    const device = options.device ?? (await (async () => {
      const navGpu = navigatorWithGPU?.gpu;
      if (!navGpu?.requestAdapter) {
        throw new Error('WebGPU is not available in this environment');
      }
      const adapter = await navGpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        throw new Error('Failed to acquire a WebGPU adapter');
      }
      return adapter.requestDevice();
    })());

    const context = options.context ?? canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Unable to acquire a WebGPU canvas context');
    }

    const format = options.format ?? navigatorWithGPU?.gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    const layers = options.layers ?? DEFAULT_LAYERS;

    let layerShaderCode = options.layerShaderCode;
    if (!layerShaderCode && (options.geometry || options.projection)) {
      const geometry = options.geometry ?? 'hypercube';
      const projection = options.projection ?? 'perspective';
      layerShaderCode = buildGlassLayerShader({ geometry, projection });
    }

    return new WebGPUPreviewHarness({
      ...options,
      canvas,
      device,
      context,
      format,
      layers,
      layerShaderCode,
      layerShaderCodes: options.layerShaderCodes,
    });
  }

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDeviceRaw;
  private readonly context: any;
  private readonly format: string;
  private readonly layers: LayerDescriptor[];
  private readonly controller: GlassUniformController;
  private readonly composer: MultiLayerGlassComposer;
  private readonly onFrame?: (info: { fps: number }) => void;
  private readonly layerShaderOverride?: string;
  private readonly layerShaderOverrides?: readonly string[];
  private readonly layerShaderCodes: string[] = [];

  private readonly uniformBindGroupLayout: unknown;
  private readonly layerBindGroupLayout: unknown;
  private readonly compositeBindGroupLayout: unknown;
  private readonly layerPipelines: unknown[] = [];
  private readonly compositePipeline: unknown;
  private readonly sampler: unknown;
  private readonly layerUniformBuffers: GPUBufferLike[] = [];
  private layerBindGroups: unknown[] = [];
  private layerTextures: GPUTextureRaw[] = [];
  private layerTextureViews: unknown[] = [];
  private readonly layerParameterData: Float32Array[] = [];

  private readonly state: PreviewState = {
    quaternion: IDENTITY_QUATERNION,
    audio: defaultAudio(),
    confidence: 1,
    visual: defaultVisual()
  };

  private presentationWidth = 0;
  private presentationHeight = 0;
  private readonly fovY: number;
  private readonly ipd: number;
  private rafHandle: number | null = null;
  private running = false;
  private lastFrameSeconds: number | null = null;
  private fpsAccumulator = 0;
  private fpsFrames = 0;

  private constructor(options: WebGPUPreviewHarnessInit) {
    this.canvas = options.canvas;
    this.device = options.device;
    this.context = options.context;
    this.format = options.format;
    this.layers = options.layers ?? DEFAULT_LAYERS;
    this.onFrame = options.onFrame;
    this.fovY = options.fovY ?? DEFAULT_FOVY;
    this.ipd = options.ipd ?? DEFAULT_IPD;
    this.layerShaderOverride = options.layerShaderCode;
    this.layerShaderOverrides = options.layerShaderCodes;

    this.composer = new MultiLayerGlassComposer({
      device: this.device,
      layers: this.layers,
      target: { width: this.canvas.width || 1280, height: this.canvas.height || 720, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
    });
    this.controller = new GlassUniformController({ composer: this.composer });
    this.controller.setQuaternion(this.state.quaternion);
    this.controller.setAudioBands(this.state.audio);
    this.controller.setVisualParams(this.state.visual);
    this.controller.setConfidence(this.state.confidence);

    const pipelines = createGlassPipelines({
      device: this.device,
      composer: this.composer,
      layers: this.layers,
      outputFormat: this.format,
      layerShaderCode: this.layerShaderOverride,
      layerShaderCodes: this.layerShaderOverrides,
    });

    this.uniformBindGroupLayout = pipelines.uniformBindGroupLayout;
    this.layerBindGroupLayout = pipelines.layerBindGroupLayout;
    this.compositeBindGroupLayout = pipelines.compositeBindGroupLayout;
    this.layerPipelines = pipelines.layerPipelines.slice();
    this.compositePipeline = pipelines.compositePipeline;
    this.sampler = pipelines.sampler;
    this.layerShaderCodes = pipelines.layerShaderCodes.slice();

    const layerParams = createLayerParameterResources(this.device, this.layers, this.layerBindGroupLayout);
    this.layerUniformBuffers.splice(0, this.layerUniformBuffers.length, ...layerParams.buffers);
    this.layerBindGroups = layerParams.bindGroups;
    this.layerParameterData.splice(0, this.layerParameterData.length, ...layerParams.data);

    this.updateCanvasSize(true);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastFrameSeconds = null;
    this.scheduleFrame();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.rafHandle != null) {
      const cancel = typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : ((id: number) => clearTimeout(id));
      cancel(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose(): void {
    this.stop();
    for (const texture of this.layerTextures) {
      try {
        texture.destroy?.();
      } catch (error) {
        console.warn('[WebGPUPreviewHarness] Failed to destroy texture', error);
      }
    }
    this.layerTextures = [];
    this.layerTextureViews = [];
  }

  forceResize(): void {
    this.updateCanvasSize(true);
  }

  setQuaternion(quaternion: Quaternion): void {
    this.state.quaternion = normalizeQuaternionTuple(quaternion);
    this.controller.setQuaternion(this.state.quaternion);
  }

  setAudioBands(bands: AudioBands): void {
    const bass = clamp01(bands?.bass ?? this.state.audio.bass);
    const mid = clamp01(bands?.mid ?? this.state.audio.mid);
    const high = clamp01(bands?.high ?? this.state.audio.high);
    const energy = clamp01(bands?.energy ?? Math.max(bass, mid, high));
    this.state.audio = { bass, mid, high, energy };
    this.controller.setAudioBands(this.state.audio);
  }

  setConfidence(confidence: number): void {
    this.state.confidence = clamp01(confidence);
    this.controller.setConfidence(this.state.confidence);
  }

  setVisualParams(vector: VisualParameterVector): void {
    this.state.visual = {
      dimension: Number(vector?.dimension ?? this.state.visual.dimension),
      morphFactor: Number(vector?.morphFactor ?? this.state.visual.morphFactor),
      rotationSpeed: Number(vector?.rotationSpeed ?? this.state.visual.rotationSpeed),
      universeModifier: Number(vector?.universeModifier ?? this.state.visual.universeModifier)
    };
    this.controller.setVisualParams(this.state.visual);
  }

  pulse(intensity = 1): void {
    this.controller.triggerPulse(intensity);
  }

  listRisks(): string[] {
    return [
      ...this.composer.summarizeRisks(),
      ...this.controller.listLocalizationRisks(),
    ];
  }

  private scheduleFrame(): void {
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16));
    this.rafHandle = raf(this.handleFrame);
  }

  private readonly handleFrame = (timestampMs: number) => {
    if (!this.running) {
      return;
    }

    const seconds = timestampMs * 0.001;
    const delta = this.lastFrameSeconds == null ? 0 : seconds - this.lastFrameSeconds;
    this.lastFrameSeconds = seconds;

    this.updateCanvasSize(false);
    this.uploadUniforms(seconds, delta);
    this.renderFrame();
    this.updateFps(delta);

    this.scheduleFrame();
  };

  private updateCanvasSize(force = false): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const width = Math.max(1, Math.floor((this.canvas.clientWidth || this.canvas.width || 960) * dpr));
    const height = Math.max(1, Math.floor((this.canvas.clientHeight || this.canvas.height || 540) * dpr));

    if (!force && width === this.presentationWidth && height === this.presentationHeight) {
      return;
    }

    this.presentationWidth = width;
    this.presentationHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.context.configure?.({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
      usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT | GPU_TEXTURE_USAGE_TEXTURE_BINDING,
      size: { width, height }
    });

    this.rebuildLayerTargets(width, height);
    this.updateLayerAspect(width / Math.max(1, height));
  }

  private rebuildLayerTargets(width: number, height: number): void {
    for (const texture of this.layerTextures) {
      try {
        texture.destroy?.();
      } catch {
        // ignored
      }
    }

    const descriptors = this.composer.buildLayerTextureDescriptors();
    this.layerTextures = descriptors.map(descriptor =>
      this.device.createTexture({
        label: descriptor.name,
        size: { width, height },
        format: descriptor.format,
        usage: descriptor.usage
      })
    );
    this.layerTextureViews = this.layerTextures.map(texture => texture.createView());
  }

  private updateLayerAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) {
      aspect = 1;
    }
    const clamped = Math.max(0.25, Math.min(8, aspect));
    this.layerParameterData.forEach((data, index) => {
      if (!data || data.length < 16) {
        return;
      }
      data[15] = clamped;
      const buffer = this.layerUniformBuffers[index];
      if (buffer) {
        this.device.queue.writeBuffer(buffer, 0, data);
      }
    });
  }

  private uploadUniforms(frameTime: number, deltaTime: number): void {
    const quaternion = this.state.quaternion;
    const audio = this.state.audio;
    const stagePosition = computePreviewTranslation(frameTime, audio);
    const anchorPosition: [number, number, number] = [
      stagePosition[0] * 0.5,
      stagePosition[1] * 0.4 + 0.18,
      stagePosition[2] * 0.5
    ];

    const mappingStatus = this.state.confidence > 0.85
      ? 'mapped'
      : this.state.confidence > 0.6
        ? 'extending'
        : 'limited';
    const trackingState = this.state.confidence > 0.35 ? 'tracking' : 'limited';
    const stageAccuracy = clamp01(0.55 + this.state.confidence * 0.4);
    const anchorAccuracy = clamp01(0.45 + this.state.visual.morphFactor * 0.5);
    const drift = clamp01(Math.abs(audio.mid - audio.bass) * 0.25 + (1 - this.state.confidence) * 0.4);

    this.controller.ingestLocalizationFrame({
      source: 'openxr-stage',
      timestamp: frameTime * 1000,
      referenceSpace: 'local-floor',
      stageTransform: {
        orientation: { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
        position: { x: stagePosition[0], y: stagePosition[1], z: stagePosition[2] }
      },
      accuracy: stageAccuracy,
      mappingStatus,
      trackingState,
      drift,
      anchor: { id: 'preview-stage', accuracy: stageAccuracy * 0.9 }
    });

    this.controller.ingestLocalizationFrame({
      source: 'spatial-anchor',
      timestamp: frameTime * 1000,
      referenceSpace: 'local-floor',
      anchor: {
        id: 'preview-anchor',
        transform: {
          orientation: { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
          position: { x: anchorPosition[0], y: anchorPosition[1], z: anchorPosition[2] }
        },
        accuracy: anchorAccuracy
      },
      drift: drift * 0.75
    });

    const frame = createMockXRFrame({
      quaternion,
      aspect: this.presentationWidth / Math.max(1, this.presentationHeight),
      fovY: this.fovY,
      ipd: this.ipd,
      position: stagePosition
    });

    this.controller.update(frame, {
      referenceSpace: {},
      frameTime,
      deltaTime,
      quaternionOverride: quaternion
    });
  }

  private renderFrame(): void {
    if (!this.layerTextures.length) {
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'GlassPreviewEncoder' });

    const globalBindGroup = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout,
      entries: [this.composer.getUniformBindGroupEntry(0)]
    });

    this.layers.forEach((layer, index) => {
      const pass = encoder.beginRenderPass({
        label: `LayerPass-${layer.name}`,
        colorAttachments: [
          {
            view: this.layerTextureViews[index],
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      });
      const pipeline = this.layerPipelines[layerIndex] ?? this.layerPipelines[0];
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, globalBindGroup);
      pass.setBindGroup(1, this.layerBindGroups[index]);
      pass.draw(3, 1, 0, 0);
      pass.end();
    });

    const compositeBindGroup = this.device.createBindGroup({
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        ...this.layerTextureViews.map((view, index) => ({ binding: index + 1, resource: view }))
      ]
    });

    const canvasTexture = this.context.getCurrentTexture?.() ?? null;
    if (!canvasTexture) {
      return;
    }

    const compositePass = encoder.beginRenderPass({
      label: 'CompositePass',
      colorAttachments: [
        {
          view: canvasTexture.createView(),
          clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, globalBindGroup);
    compositePass.setBindGroup(1, compositeBindGroup);
    compositePass.draw(3, 1, 0, 0);
    compositePass.end();

    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);
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

export default WebGPUPreviewHarness;
