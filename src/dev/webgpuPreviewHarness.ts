import { MultiLayerGlassComposer, type LayerDescriptor } from '../ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';
import { WebXRQuaternionBridge, type AudioBands, type VisualParameterVector, type XRFrameLike } from '../ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import { normalize as normalizeQuaternionTuple, type Quaternion } from '../core/quaternion/index.ts';

const GPU_SHADER_STAGE_VERTEX = 0x1;
const GPU_SHADER_STAGE_FRAGMENT = 0x2;
const GPU_TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const GPU_TEXTURE_USAGE_TEXTURE_BINDING = 0x4;
const GPU_BUFFER_USAGE_UNIFORM = 0x40;
const GPU_BUFFER_USAGE_COPY_DST = 0x8;

const DEFAULT_LAYERS: LayerDescriptor[] = [
  { name: 'FrostedShell', pipelineLabel: 'LayerFrost', blurRadius: 7 },
  { name: 'Refraction', pipelineLabel: 'LayerRefraction', blurRadius: 5 },
  { name: 'GlyphVeil', pipelineLabel: 'LayerGlyph' },
  { name: 'ParticleHaze', pipelineLabel: 'LayerHaze', blurRadius: 3 },
  { name: 'Highlights', pipelineLabel: 'LayerHighlights' }
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

export interface GPUDeviceRaw {
  readonly queue: {
    writeBuffer(
      buffer: unknown,
      bufferOffset: number,
      data: ArrayBufferView | ArrayBuffer,
      dataOffset?: number,
      size?: number
    ): void;
  };
  createBuffer(descriptor: { size: number; usage: number; label?: string }): unknown;
  createSampler(descriptor: Record<string, unknown>): unknown;
  createTexture(descriptor: Record<string, unknown>): GPUTextureRaw;
  createBindGroupLayout(descriptor: Record<string, unknown>): unknown;
  createPipelineLayout(descriptor: Record<string, unknown>): unknown;
  createShaderModule(descriptor: Record<string, unknown>): unknown;
  createRenderPipeline(descriptor: Record<string, unknown>): unknown;
  createCommandEncoder(descriptor?: Record<string, unknown>): GPUCommandEncoderRaw;
  createBindGroup(descriptor: Record<string, unknown>): unknown;
}

interface GPUTextureRaw {
  createView(descriptor?: Record<string, unknown>): unknown;
  destroy?: () => void;
}

interface GPUCommandEncoderRaw {
  beginRenderPass(descriptor: Record<string, unknown>): GPURenderPassEncoderRaw;
  finish(): unknown;
}

interface GPURenderPassEncoderRaw {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  end(): void;
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
}

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

const LAYER_SHADER = `
struct GlassUniforms {
  leftViewProj : mat4x4<f32>,
  rightViewProj : mat4x4<f32>,
  headMatrix : mat4x4<f32>,
  rotor4d : vec4<f32>,
  euler : vec4<f32>,
  metrics : vec4<f32>,
  audio : vec4<f32>,
};

struct LayerUniforms {
  color : vec4<f32>;
};

struct VSOutput {
  @builtin(position) position : vec4<f32>;
  @location(0) uv : vec2<f32>;
};

@group(0) @binding(0) var<uniform> glass : GlassUniforms;
@group(1) @binding(0) var<uniform> layer : LayerUniforms;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VSOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
    vec2<f32>(0.0, 2.0)
  );
  var output : VSOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

@fragment
fn fsMain(input : VSOutput) -> @location(0) vec4<f32> {
  let uv = input.uv * 0.5;
  let rotor = glass.rotor4d.xyz;
  let audio = glass.audio;
  let phase = glass.metrics.x * 0.6 + dot(rotor, vec3<f32>(0.9, 1.1, 1.3));
  let swirl = sin(phase + uv.x * 3.4 + uv.y * 2.1);
  let sparkle = sin(glass.metrics.x * (1.2 + audio.w * 0.8) + dot(uv, uv) * 4.2);
  let tint = layer.color.rgb * (0.65 + audio.w * 0.45);
  let bandInfluence = vec3<f32>(audio.x, audio.y, audio.z) * 0.6;
  let finalColor = tint + bandInfluence + vec3<f32>(swirl * 0.1, sparkle * 0.12, abs(swirl) * 0.08);
  return vec4<f32>(finalColor, 1.0);
}
`;

function buildCompositeShader(layerCount: number): string {
  if (layerCount < 1) {
    throw new Error('Composite shader requires at least one layer');
  }
  const textureDecl = new Array(layerCount)
    .fill(null)
    .map((_, index) => `@group(1) @binding(${index + 1}) var layer${index} : texture_2d<f32>;`)
    .join('\n');

  const sampleCode = new Array(layerCount)
    .fill(null)
    .map((_, index) => {
      const weight = ((index + 1) / layerCount).toFixed(6);
      return `  let sample${index} = textureSample(layer${index}, layerSampler, uv);\n` +
        `  accum += sample${index}.rgb * ${weight};\n` +
        `  weightSum += ${weight};`;
    })
    .join('\n');

  return `
struct GlassUniforms {
  leftViewProj : mat4x4<f32>,
  rightViewProj : mat4x4<f32>,
  headMatrix : mat4x4<f32>,
  rotor4d : vec4<f32>,
  euler : vec4<f32>,
  metrics : vec4<f32>,
  audio : vec4<f32>,
};

struct VSOutput {
  @builtin(position) position : vec4<f32>;
  @location(0) uv : vec2<f32>;
};

@group(0) @binding(0) var<uniform> glass : GlassUniforms;
@group(1) @binding(0) var layerSampler : sampler;
${textureDecl}

@vertex
fn vsComposite(@builtin(vertex_index) vertexIndex : u32) -> VSOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
    vec2<f32>(0.0, 2.0)
  );
  var output : VSOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

@fragment
fn fsComposite(input : VSOutput) -> @location(0) vec4<f32> {
  let uv = input.uv * 0.5;
  var accum = vec3<f32>(0.0);
  var weightSum = 0.0;
${sampleCode}
  let combined = accum / max(weightSum, 1e-3);
  let audio = glass.audio;
  let glow = vec3<f32>(0.18, 0.16, 0.22) + audio.xyz * 0.4;
  let brightness = 0.75 + audio.w * 0.55;
  return vec4<f32>(combined * brightness + glow * 0.25, 1.0);
}
`;
}

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
  const transform = {
    orientation,
    position: { x: 0, y: 0, z: 0 },
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

    return new WebGPUPreviewHarness({
      ...options,
      canvas,
      device,
      context,
      format
    });
  }

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDeviceRaw;
  private readonly context: any;
  private readonly format: string;
  private readonly layers: LayerDescriptor[];
  private readonly bridge: WebXRQuaternionBridge;
  private readonly composer: MultiLayerGlassComposer;
  private readonly onFrame?: (info: { fps: number }) => void;

  private readonly uniformBindGroupLayout: unknown;
  private readonly layerBindGroupLayout: unknown;
  private readonly compositeBindGroupLayout: unknown;
  private readonly layerPipeline: unknown;
  private readonly compositePipeline: unknown;
  private readonly sampler: unknown;
  private readonly layerUniformBuffers: unknown[] = [];
  private layerBindGroups: unknown[] = [];
  private layerTextures: GPUTextureRaw[] = [];
  private layerTextureViews: unknown[] = [];

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
  private pulseEnergy = 0;

  private constructor(options: Required<WebGPUPreviewHarnessOptions>) {
    this.canvas = options.canvas;
    this.device = options.device;
    this.context = options.context;
    this.format = options.format;
    this.layers = options.layers ?? DEFAULT_LAYERS;
    this.onFrame = options.onFrame;
    this.fovY = options.fovY ?? DEFAULT_FOVY;
    this.ipd = options.ipd ?? DEFAULT_IPD;

    this.composer = new MultiLayerGlassComposer({
      device: this.device,
      layers: this.layers,
      target: { width: this.canvas.width || 1280, height: this.canvas.height || 720, format: 'rgba16float' },
      uniformSize: WebXRQuaternionBridge.uniformByteSize
    });
    this.bridge = new WebXRQuaternionBridge({ composer: this.composer });

    this.uniformBindGroupLayout = this.device.createBindGroupLayout({
      label: 'GlassGlobals',
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE_VERTEX | GPU_SHADER_STAGE_FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });

    this.layerBindGroupLayout = this.device.createBindGroupLayout({
      label: 'GlassLayerParams',
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE_FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });

    this.compositeBindGroupLayout = this.device.createBindGroupLayout({
      label: 'GlassComposite',
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE_FRAGMENT,
          sampler: { type: 'filtering' }
        },
        ...this.layers.map((_, index) => ({
          binding: index + 1,
          visibility: GPU_SHADER_STAGE_FRAGMENT,
          texture: { sampleType: 'float' }
        }))
      ]
    });

    const layerShaderModule = this.device.createShaderModule({ label: 'LayerShader', code: LAYER_SHADER });
    const compositeShaderModule = this.device.createShaderModule({
      label: 'CompositeShader',
      code: buildCompositeShader(this.layers.length)
    });

    const layerPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout, this.layerBindGroupLayout]
    });

    const compositePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformBindGroupLayout, this.compositeBindGroupLayout]
    });

    this.layerPipeline = this.device.createRenderPipeline({
      label: 'GlassLayerPipeline',
      layout: layerPipelineLayout,
      vertex: { module: layerShaderModule, entryPoint: 'vsMain' },
      fragment: {
        module: layerShaderModule,
        entryPoint: 'fsMain',
        targets: [
          {
            format: this.composer.target.format ?? 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.compositePipeline = this.device.createRenderPipeline({
      label: 'GlassCompositePipeline',
      layout: compositePipelineLayout,
      vertex: { module: compositeShaderModule, entryPoint: 'vsComposite' },
      fragment: {
        module: compositeShaderModule,
        entryPoint: 'fsComposite',
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.sampler = this.device.createSampler({
      label: 'GlassSampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.layers.forEach((layer, index) => {
      const buffer = this.device.createBuffer({
        size: Float32Array.BYTES_PER_ELEMENT * 4,
        usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST,
        label: `${layer.name}-params`
      });
      this.layerUniformBuffers.push(buffer);
      const colorSeed = (index + 1) / (this.layers.length + 1);
      const color = new Float32Array([
        0.35 + colorSeed * 0.45,
        0.45 + Math.sin(colorSeed * Math.PI) * 0.3,
        0.55 + Math.cos(colorSeed * Math.PI * 0.5) * 0.25,
        colorSeed
      ]);
      this.device.queue.writeBuffer(buffer, 0, color);
    });

    this.layerBindGroups = this.layerUniformBuffers.map(buffer =>
      this.device.createBindGroup({
        layout: this.layerBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer }
          }
        ]
      })
    );

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
  }

  setAudioBands(bands: AudioBands): void {
    const bass = clamp01(bands?.bass ?? this.state.audio.bass);
    const mid = clamp01(bands?.mid ?? this.state.audio.mid);
    const high = clamp01(bands?.high ?? this.state.audio.high);
    const energy = clamp01(bands?.energy ?? Math.max(bass, mid, high));
    this.state.audio = { bass, mid, high, energy };
  }

  setConfidence(confidence: number): void {
    this.state.confidence = clamp01(confidence);
  }

  setVisualParams(vector: VisualParameterVector): void {
    this.state.visual = {
      dimension: Number(vector?.dimension ?? this.state.visual.dimension),
      morphFactor: Number(vector?.morphFactor ?? this.state.visual.morphFactor),
      rotationSpeed: Number(vector?.rotationSpeed ?? this.state.visual.rotationSpeed),
      universeModifier: Number(vector?.universeModifier ?? this.state.visual.universeModifier)
    };
  }

  pulse(intensity = 1): void {
    this.pulseEnergy = Math.max(this.pulseEnergy, clamp01(intensity));
  }

  listRisks(): string[] {
    return this.composer.summarizeRisks();
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

  private uploadUniforms(frameTime: number, deltaTime: number): void {
    const audio = { ...this.state.audio };
    if (this.pulseEnergy > 0 && deltaTime >= 0) {
      const boost = this.pulseEnergy * 0.75;
      audio.bass = clamp01(audio.bass + boost * 0.5);
      audio.mid = clamp01(audio.mid + boost * 0.35);
      audio.high = clamp01(audio.high + boost * 0.65);
      audio.energy = clamp01(Math.max(audio.energy, boost));
      this.pulseEnergy = Math.max(0, this.pulseEnergy - deltaTime * 1.5);
    }

    const frame = createMockXRFrame({
      quaternion: this.state.quaternion,
      aspect: this.presentationWidth / Math.max(1, this.presentationHeight),
      fovY: this.fovY,
      ipd: this.ipd
    });

    this.bridge.updateFromXRFrame(frame, {
      referenceSpace: {},
      frameTime,
      deltaTime,
      audio,
      confidence: this.state.confidence,
      visualParams: this.state.visual
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
      pass.setPipeline(this.layerPipeline);
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
