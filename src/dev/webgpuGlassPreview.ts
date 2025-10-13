/// <reference lib="dom" />

import {
  MultiLayerGlassComposer,
  type LayerDescriptor
} from '../ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';

const GPU_BUFFER_USAGE_UNIFORM = 0x40;
const GPU_BUFFER_USAGE_COPY_DST = 0x8;

export interface WebGPUStatusCallback {
  (message: string): void;
}

export interface WebGPUPreviewOptions {
  readonly onStatus?: WebGPUStatusCallback;
  readonly layers?: LayerDescriptor[];
}

export const DEFAULT_LAYER_DESCRIPTORS: LayerDescriptor[] = [
  { name: 'Backplate', pipelineLabel: 'backplate', blurRadius: 9 },
  { name: 'Caustics', pipelineLabel: 'caustics', blurRadius: 5 },
  { name: 'Particles', pipelineLabel: 'particles', blurRadius: 3 },
  { name: 'Highlights', pipelineLabel: 'highlights', blurRadius: 0 },
  { name: 'Vignette', pipelineLabel: 'vignette', blurRadius: 0 }
];

const FULLSCREEN_TRIANGLE_VERTEX = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0, 3.0),
    vec2<f32>(3.0, -1.0)
  );

  var output : VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = output.position.xy * 0.5 + vec2<f32>(0.5, 0.5);
  return output;
}
`;

const GLOBALS_STRUCT = /* wgsl */ `
struct GlassGlobals {
  time : f32,
  deltaTime : f32,
  audioBass : f32,
  audioMid : f32,
  audioHigh : f32,
  morph : f32,
  padding : vec2<f32>,
};

@group(0) @binding(0) var<uniform> globals : GlassGlobals;
`;

const LAYER_SHADER_SOURCE = /* wgsl */ `
${FULLSCREEN_TRIANGLE_VERTEX}
${GLOBALS_STRUCT}

struct LayerUniforms {
  color : vec4<f32>,
  meta : vec4<f32>, // x: layer index, y: intensity, z: blurRadius, w: unused
};

@group(1) @binding(0) var<uniform> layer : LayerUniforms;

@fragment
fn fs(mainIn : VertexOutput) -> @location(0) vec4<f32> {
  let layerIndex = layer.meta.x;
  let baseColor = layer.color.rgb;
  let alpha = clamp(layer.color.a, 0.0, 1.0);
  let energy = layer.meta.y;

  let uv = mainIn.uv * 2.0 - vec2<f32>(1.0, 1.0);
  let swirl = sin(globals.time * (0.8 + layerIndex * 0.12) + dot(uv, vec2<f32>(1.7 + layerIndex * 0.33, 1.2 + layerIndex * 0.21)));
  let pulse = 0.55 + 0.45 * energy * (0.6 + 0.4 * sin(globals.time * (1.3 + layerIndex * 0.17) + length(uv) * 2.4));
  let tonal = baseColor * (0.65 + 0.35 * swirl);
  let rgb = tonal * pulse * (1.0 + globals.audioHigh * 0.25);
  let finalAlpha = alpha * clamp(0.75 + 0.25 * globals.audioMid, 0.0, 1.0);
  return vec4<f32>(rgb * finalAlpha, finalAlpha);
}
`;

export function createCompositeShaderSource(layerCount: number): string {
  if (!Number.isInteger(layerCount) || layerCount <= 0) {
    throw new Error('createCompositeShaderSource requires a positive integer layerCount');
  }

  let textureDeclarations = '';
  let accumulation = '  var color : vec4<f32> = vec4<f32>(0.0);\n';

  for (let i = 0; i < layerCount; i += 1) {
    textureDeclarations += `@group(1) @binding(${i + 1}) var layer${i} : texture_2d<f32>;\n`;
    accumulation += `  do {\n    let sample = textureSample(layer${i}, linearSampler, mainIn.uv);\n    color = color + sample * (1.0 - color.a);\n  } while (false);\n`;
  }

  return /* wgsl */ `
${FULLSCREEN_TRIANGLE_VERTEX}
${GLOBALS_STRUCT}
@group(1) @binding(0) var linearSampler : sampler;
${textureDeclarations}

@fragment
fn fs(mainIn : VertexOutput) -> @location(0) vec4<f32> {
${accumulation}
  let gammaCorrected = pow(color.rgb, vec3<f32>(0.92));
  return vec4<f32>(gammaCorrected, clamp(color.a, 0.0, 1.0));
}
`;
}

interface LayerResources {
  readonly uniformBuffer: GPUBuffer;
  readonly uniformData: Float32Array;
  readonly bindGroup: GPUBindGroup;
}

interface PreviewResources {
  layerPipeline: GPURenderPipeline;
  compositePipeline: GPURenderPipeline;
  globalLayout: GPUBindGroupLayout;
  layerLayout: GPUBindGroupLayout;
  compositeLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
  layerResources: LayerResources[];
  layerTextures: GPUTexture[];
  layerTextureViews: GPUTextureView[];
  compositeBindGroup: GPUBindGroup;
}

export class WebGPUGlassPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatus: WebGPUStatusCallback;
  private readonly layers: LayerDescriptor[];

  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private presentationFormat: GPUTextureFormat | null = null;
  private composer: MultiLayerGlassComposer | null = null;
  private resources: PreviewResources | null = null;
  private animationFrame: number | null = null;
  private lastTime = 0;
  private readonly globalUniformData = new Float32Array(16);

  constructor(canvas: HTMLCanvasElement, options: WebGPUPreviewOptions = {}) {
    this.canvas = canvas;
    this.onStatus = options.onStatus ?? (() => {});
    this.layers = (options.layers && options.layers.length > 0)
      ? options.layers
      : DEFAULT_LAYER_DESCRIPTORS;
  }

  async initialize(): Promise<void> {
    if (!('gpu' in navigator) || !navigator.gpu) {
      this.onStatus('WebGPU not available in this browser');
      return;
    }

    this.onStatus('Requesting XR-compatible WebGPU device…');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance', xrCompatible: true }).catch(() => null);
    if (!adapter) {
      this.onStatus('Failed to acquire WebGPU adapter');
      return;
    }

    this.device = await adapter.requestDevice().catch(() => null);
    if (!this.device) {
      this.onStatus('Failed to acquire WebGPU device');
      return;
    }

    this.device.lost.then(info => {
      this.onStatus(`WebGPU device lost: ${info.message}`);
      this.stop();
    }).catch(() => {});

    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      this.onStatus('Failed to create WebGPU canvas context');
      return;
    }

    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.resizeCanvas();

    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'premultiplied'
    });

    this.composer = new MultiLayerGlassComposer({
      device: this.device,
      layers: this.layers,
      target: {
        width: this.canvas.width,
        height: this.canvas.height,
        format: 'rgba16float'
      },
      uniformSize: this.globalUniformData.byteLength
    });

    this.resources = this.createResources();

    const risks = this.composer.summarizeRisks();
    if (risks.length > 0) {
      this.onStatus(`Ready • ${risks.join(' | ')}`);
    } else {
      this.onStatus('Ready • multi-pass renderer active');
    }

    this.start();
  }

  stop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  dispose(): void {
    this.stop();
    this.resources?.layerResources.forEach(resource => {
      resource.uniformBuffer.destroy();
    });
    this.composer?.uniformRing.dispose();
    this.resources = null;
    this.context = null;
    this.device = null;
  }

  private resizeCanvas(): void {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor((rect.width || 640) * pixelRatio));
    const height = Math.max(200, Math.floor((rect.height || 360) * pixelRatio));
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private createResources(): PreviewResources {
    if (!this.device || !this.context || !this.presentationFormat || !this.composer) {
      throw new Error('WebGPUGlassPreview is not initialized');
    }

    const device = this.device;

    const globalLayout = device.createBindGroupLayout({
      label: 'GlassGlobalsLayout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });

    const layerLayout = device.createBindGroupLayout({
      label: 'GlassLayerLayout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    });

    const compositeEntries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' }
      }
    ];

    const layerTextureDescriptors = this.composer.buildLayerTextureDescriptors();
    const layerTextures: GPUTexture[] = [];
    const layerTextureViews: GPUTextureView[] = [];

    layerTextureDescriptors.forEach(descriptor => {
      const texture = device.createTexture({
        label: descriptor.name,
        size: { width: this.canvas.width, height: this.canvas.height, depthOrArrayLayers: 1 },
        format: descriptor.format,
        usage: descriptor.usage
      });
      layerTextures.push(texture);
      layerTextureViews.push(texture.createView());
    });

    for (let i = 0; i < layerTextures.length; i += 1) {
      compositeEntries.push({
        binding: i + 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' }
      });
    }

    const compositeLayout = device.createBindGroupLayout({
      label: 'GlassCompositeLayout',
      entries: compositeEntries
    });

    const sampler = device.createSampler({
      label: 'GlassLinearSampler',
      minFilter: 'linear',
      magFilter: 'linear'
    });

    const layerShaderModule = device.createShaderModule({
      label: 'GlassLayerShader',
      code: LAYER_SHADER_SOURCE
    });

    const layerPipeline = device.createRenderPipeline({
      label: 'GlassLayerPipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [globalLayout, layerLayout]
      }),
      vertex: {
        module: layerShaderModule,
        entryPoint: 'vs'
      },
      fragment: {
        module: layerShaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' }
    });

    const compositeShaderModule = device.createShaderModule({
      label: 'GlassCompositeShader',
      code: createCompositeShaderSource(layerTextures.length)
    });

    const compositePipeline = device.createRenderPipeline({
      label: 'GlassCompositePipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [globalLayout, compositeLayout]
      }),
      vertex: {
        module: compositeShaderModule,
        entryPoint: 'vs'
      },
      fragment: {
        module: compositeShaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: this.presentationFormat,
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' }
    });

    const layerResources: LayerResources[] = this.layers.map((layer, index) => {
      const buffer = device.createBuffer({
        label: `GlassLayerUniform#${layer.name}`,
        size: 32,
        usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST
      });
      const data = new Float32Array(8);
      const palette = LAYER_COLOR_PRESET[index % LAYER_COLOR_PRESET.length];
      data[0] = palette[0];
      data[1] = palette[1];
      data[2] = palette[2];
      data[3] = palette[3];
      data[4] = index;
      data[5] = 1;
      data[6] = layer.blurRadius ?? 0;
      data[7] = 0;
      device.queue.writeBuffer(buffer, 0, data);
      const bindGroup = device.createBindGroup({
        label: `GlassLayerBindGroup#${layer.name}`,
        layout: layerLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer }
          }
        ]
      });
      return { uniformBuffer: buffer as GPUBuffer, uniformData: data, bindGroup };
    });

    const compositeEntriesInstance: GPUBindGroupEntry[] = [
      { binding: 0, resource: sampler }
    ];
    layerTextureViews.forEach((view, index) => {
      compositeEntriesInstance.push({ binding: index + 1, resource: view });
    });

    const compositeBindGroup = device.createBindGroup({
      label: 'GlassCompositeBindGroup',
      layout: compositeLayout,
      entries: compositeEntriesInstance
    });

    return {
      layerPipeline,
      compositePipeline,
      globalLayout,
      layerLayout,
      compositeLayout,
      sampler,
      layerResources,
      layerTextures,
      layerTextureViews,
      compositeBindGroup
    };
  }

  private start(): void {
    this.lastTime = performance.now() / 1000;
    const tick = () => {
      this.renderFrame();
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private renderFrame(): void {
    if (!this.device || !this.resources || !this.composer || !this.context) {
      return;
    }

    const now = performance.now() / 1000;
    const delta = Math.max(0, now - this.lastTime);
    this.lastTime = now;

    this.updateGlobalUniforms(now, delta);
    this.updateLayerUniforms(now);

    const globalBindGroup = this.device.createBindGroup({
      label: 'GlassGlobalsBindGroup',
      layout: this.resources.globalLayout,
      entries: [this.composer.getUniformBindGroupEntry(0)]
    });

    const encoder = this.device.createCommandEncoder({ label: 'GlassPreviewEncoder' });
    this.encodeLayerPasses(encoder, globalBindGroup);
    this.encodeCompositePass(encoder, globalBindGroup);
    this.device.queue.submit([encoder.finish()]);
  }

  private updateGlobalUniforms(time: number, delta: number): void {
    if (!this.composer) {
      return;
    }

    const data = this.globalUniformData;
    data[0] = time;
    data[1] = delta;
    data[2] = 0.55 + 0.45 * Math.sin(time * 0.75);
    data[3] = 0.5 + 0.5 * Math.sin(time * 1.1 + 1.2);
    data[4] = 0.5 + 0.5 * Math.sin(time * 1.7 + 2.1);
    data[5] = 0.5 + 0.5 * Math.sin(time * 0.4 + 0.4);
    data[6] = 0;
    data[7] = 0;

    this.composer.updateUniforms(data);
  }

  private updateLayerUniforms(time: number): void {
    if (!this.resources || !this.device) {
      return;
    }
    const bass = this.globalUniformData[2];
    const mid = this.globalUniformData[3];

    this.resources.layerResources.forEach((resource, index) => {
      const wobble = 0.65 + 0.35 * Math.sin(time * (0.6 + index * 0.2) + bass * 3 + index);
      resource.uniformData[5] = wobble * (0.85 + 0.15 * mid);
      this.device!.queue.writeBuffer(resource.uniformBuffer, 0, resource.uniformData);
    });
  }

  private encodeLayerPasses(encoder: GPUCommandEncoder, globals: GPUBindGroup): void {
    if (!this.resources) {
      return;
    }

    this.resources.layerTextureViews.forEach((view, index) => {
      const pass = encoder.beginRenderPass({
        label: `GlassLayerPass#${index}`,
        colorAttachments: [
          {
            view,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
          }
        ]
      });
      pass.setPipeline(this.resources!.layerPipeline);
      pass.setBindGroup(0, globals);
      pass.setBindGroup(1, this.resources!.layerResources[index].bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
    });
  }

  private encodeCompositePass(encoder: GPUCommandEncoder, globals: GPUBindGroup): void {
    if (!this.resources || !this.context) {
      return;
    }

    const swapTexture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      label: 'GlassCompositePass',
      colorAttachments: [
        {
          view: swapTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }
      ]
    });
    pass.setPipeline(this.resources.compositePipeline);
    pass.setBindGroup(0, globals);
    pass.setBindGroup(1, this.resources.compositeBindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
}

const LAYER_COLOR_PRESET: Array<readonly [number, number, number, number]> = [
  [0.18, 0.32, 0.95, 0.72],
  [0.38, 0.86, 0.98, 0.6],
  [0.94, 0.48, 0.94, 0.75],
  [0.98, 0.76, 0.42, 0.5],
  [0.35, 0.21, 0.68, 0.65]
];

export async function mountWebGPUGlassPreview(
  canvas: HTMLCanvasElement,
  options: WebGPUPreviewOptions = {}
): Promise<WebGPUGlassPreview> {
  const preview = new WebGPUGlassPreview(canvas, options);
  await preview.initialize();
  return preview;
}
