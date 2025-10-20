import type { LayerDescriptor, MultiLayerGlassComposer } from './MultiLayerGlassComposer.ts';
import { buildGlassLayerShader } from './GlassShaderLibrary.ts';
import {
  GPU_BUFFER_USAGE_COPY_DST,
  GPU_BUFFER_USAGE_UNIFORM,
  GPU_SHADER_STAGE_FRAGMENT,
  GPU_SHADER_STAGE_VERTEX,
  GPU_TEXTURE_USAGE_RENDER_ATTACHMENT,
  GPU_TEXTURE_USAGE_TEXTURE_BINDING,
  type GPUDeviceRaw,
} from './GPUInterfaces.ts';
import type { GPUBufferLike } from './TripleBufferedUniform.ts';

const shaderModuleCache = new WeakMap<GPUDeviceRaw, Map<string, unknown>>();
const pipelineCache = new WeakMap<GPUDeviceRaw, Map<string, GlassPipelineResources>>();

function getCachedShaderModule(device: GPUDeviceRaw, code: string, label: string): unknown {
  let cache = shaderModuleCache.get(device);
  if (!cache) {
    cache = new Map();
    shaderModuleCache.set(device, cache);
  }

  const existing = cache.get(code);
  if (existing) {
    return existing;
  }

  const module = device.createShaderModule({
    label,
    code,
  });
  cache.set(code, module);
  return module;
}

export interface GlassPipelineResources {
  readonly uniformBindGroupLayout: unknown;
  readonly layerBindGroupLayout: unknown;
  readonly compositeBindGroupLayout: unknown;
  readonly layerPipelines: unknown[];
  readonly compositePipeline: unknown;
  readonly sampler: unknown;
  readonly layerShaderModules: unknown[];
  readonly layerShaderCodes: string[];
}

export interface LayerParameterResources {
  readonly buffers: GPUBufferLike[];
  readonly bindGroups: unknown[];
  readonly data: Float32Array[];
}

export function buildCompositeShader(layerCount: number): string {
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
  localization : vec4<f32>,
  visual : vec4<f32>,
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

export interface GlassPipelineFactoryOptions {
  readonly device: GPUDeviceRaw;
  readonly composer: MultiLayerGlassComposer;
  readonly layers: LayerDescriptor[];
  readonly outputFormat: string;
  readonly layerShaderCode?: string;
  readonly layerShaderCodes?: readonly (string | null | undefined)[];
}

export function createGlassPipelines(options: GlassPipelineFactoryOptions): GlassPipelineResources {
  const { device, composer, layers, outputFormat, layerShaderCode, layerShaderCodes } = options;

  const cacheKeyPayload = {
    format: outputFormat,
    layerOverrides: layerShaderCodes?.map(code => code ?? null) ?? null,
    sharedOverride: layerShaderCode ?? null,
    layers: layers.map(layer => ({
      label: layer.pipelineLabel ?? layer.name ?? '',
      blurRadius: layer.blurRadius ?? 0,
      geometry: layer.shader?.geometry ?? null,
      projection: layer.shader?.projection ?? null,
      hasCustomCode: typeof layer.shader?.code === 'string' ? layer.shader.code.length : 0,
    })),
  };
  const cacheKey = JSON.stringify(cacheKeyPayload);

  let deviceCache = pipelineCache.get(device);
  if (!deviceCache) {
    deviceCache = new Map();
    pipelineCache.set(device, deviceCache);
  }

  const cached = deviceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const uniformBindGroupLayout = device.createBindGroupLayout({
    label: 'GlassGlobals',
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_VERTEX | GPU_SHADER_STAGE_FRAGMENT,
        buffer: { type: 'uniform' }
      }
    ]
  });

  const layerBindGroupLayout = device.createBindGroupLayout({
    label: 'GlassLayerParams',
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_FRAGMENT,
        buffer: { type: 'uniform' }
      }
    ]
  });

  const compositeBindGroupLayout = device.createBindGroupLayout({
    label: 'GlassComposite',
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_FRAGMENT,
        sampler: { type: 'filtering' }
      },
      ...layers.map((_, index) => ({
        binding: index + 1,
        visibility: GPU_SHADER_STAGE_FRAGMENT,
        texture: { sampleType: 'float' }
      }))
    ]
  });

  const shaderCodes = layers.map((layer, index) => {
    const explicit = layerShaderCodes?.[index];
    if (typeof explicit === 'string' && explicit.length > 0) {
      return explicit;
    }
    if (layerShaderCode) {
      return layerShaderCode;
    }
    if (layer.shader?.code) {
      return layer.shader.code;
    }
    const geometry = layer.shader?.geometry ?? 'hypercube';
    const projection = layer.shader?.projection ?? 'perspective';
    return buildGlassLayerShader({ geometry, projection });
  });

  const layerShaderModules = shaderCodes.map((code, index) =>
    getCachedShaderModule(device, code, `${layers[index]?.pipelineLabel ?? `GlassLayer${index}`}-Shader`)
  );

  const compositeShaderModule = getCachedShaderModule(device, buildCompositeShader(layers.length), 'CompositeShader');

  const layerPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [uniformBindGroupLayout, layerBindGroupLayout]
  });

  const compositePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [uniformBindGroupLayout, compositeBindGroupLayout]
  });

  const layerPipelines = layerShaderModules.map((module, index) =>
    device.createRenderPipeline({
      label: `${layers[index]?.pipelineLabel ?? `GlassLayer${index}`}-Pipeline`,
      layout: layerPipelineLayout,
      vertex: { module, entryPoint: 'vsMain' },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [
          {
            format: composer.target.format ?? 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list' }
    })
  );

  const compositePipeline = device.createRenderPipeline({
    label: 'GlassCompositePipeline',
    layout: compositePipelineLayout,
    vertex: { module: compositeShaderModule, entryPoint: 'vsComposite' },
    fragment: {
      module: compositeShaderModule,
      entryPoint: 'fsComposite',
      targets: [
        {
          format: outputFormat,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }
      ]
    },
    primitive: { topology: 'triangle-list' }
  });

  const sampler = device.createSampler({
    label: 'GlassSampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge'
  });

  const resources: GlassPipelineResources = {
    uniformBindGroupLayout,
    layerBindGroupLayout,
    compositeBindGroupLayout,
    layerPipelines,
    compositePipeline,
    sampler,
    layerShaderModules,
    layerShaderCodes: shaderCodes,
  };

  deviceCache.set(cacheKey, resources);
  return resources;
}

export function createLayerParameterResources(
  device: GPUDeviceRaw,
  layers: LayerDescriptor[],
  layerBindGroupLayout: unknown
): LayerParameterResources {
  const buffers: GPUBufferLike[] = [];
  const data: Float32Array[] = [];

  layers.forEach((layer, index) => {
    const buffer = device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 20,
      usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST,
      label: `${layer.name}-params`
    }) as GPUBufferLike;

    const colorSeed = (index + 1) / (layers.length + 1);
    const material = layer.material ?? {};

    const primary = material.primaryColor ?? [
      0.45 + colorSeed * 0.35,
      0.25 + Math.sin(colorSeed * Math.PI * 1.3) * 0.3,
      0.55 + Math.cos(colorSeed * Math.PI * 0.7) * 0.25,
    ];
    const secondary = material.secondaryColor ?? [
      0.25 + Math.sin(colorSeed * Math.PI) * 0.4,
      0.45 + Math.cos(colorSeed * Math.PI * 0.8) * 0.3,
      0.55 + colorSeed * 0.25,
    ];
    const background = material.backgroundColor ?? [
      0.05 + 0.15 * colorSeed,
      0.04 + 0.1 * (1 - colorSeed),
      0.08 + 0.12 * Math.sin(colorSeed * Math.PI * 0.5),
    ];

    const patternIntensity = Number.isFinite(material.patternIntensity)
      ? Math.max(0, material.patternIntensity ?? 0)
      : 0.85 - colorSeed * 0.35;
    const glitchIntensity = Number.isFinite(material.glitchIntensity)
      ? Math.max(0, material.glitchIntensity ?? 0)
      : 0.05 + (1 - colorSeed) * 0.08;
    const colorShift = Number.isFinite(material.colorShift)
      ? material.colorShift ?? 0
      : (colorSeed - 0.5) * 0.4;
    const lattice = material.lattice ?? [
      8.0 + colorSeed * 4.0,
      0.02 + colorSeed * 0.01,
      0.02 + (1 - colorSeed) * 0.015,
      0.03 + colorSeed * 0.01,
    ];

    const layerData = new Float32Array([
      primary[0], primary[1], primary[2], 1.0,
      secondary[0], secondary[1], secondary[2], 1.0,
      background[0], background[1], background[2], 1.0,
      patternIntensity, glitchIntensity, colorShift, 1.0,
      lattice[0], lattice[1], lattice[2], lattice[3],
    ]);

    device.queue.writeBuffer(buffer, 0, layerData);
    buffers.push(buffer);
    data.push(layerData);
  });

  const bindGroups = buffers.map(buffer =>
    device.createBindGroup({
      layout: layerBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer }
        }
      ]
    })
  );

  return { buffers, bindGroups, data };
}

export function createLayerTargetDescriptor(width: number, height: number) {
  return {
    size: { width, height, depthOrArrayLayers: 1 },
    format: 'rgba16float',
    usage: GPU_TEXTURE_USAGE_RENDER_ATTACHMENT | GPU_TEXTURE_USAGE_TEXTURE_BINDING,
    label: `GlassLayer-${width}x${height}`
  };
}
