import type { LayerDescriptor, MultiLayerGlassComposer } from './MultiLayerGlassComposer.ts';
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

export interface GlassPipelineResources {
  readonly uniformBindGroupLayout: unknown;
  readonly layerBindGroupLayout: unknown;
  readonly compositeBindGroupLayout: unknown;
  readonly layerPipeline: unknown;
  readonly compositePipeline: unknown;
  readonly sampler: unknown;
}

export interface LayerParameterResources {
  readonly buffers: GPUBufferLike[];
  readonly bindGroups: unknown[];
  readonly data: Float32Array[];
}

export const LAYER_SHADER = `
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

struct LayerUniforms {
  primaryColor : vec4<f32>;
  secondaryColor : vec4<f32>;
  backgroundColor : vec4<f32>;
  intensities : vec4<f32>;
  lattice : vec4<f32>;
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
  let aspect = max(layer.intensities.w, 0.25);
  let uv = (input.uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let time = glass.metrics.x;
  let audio = glass.audio;
  let swirl = sin(time * 0.35 + uv.x * 3.1 + uv.y * 2.4);
  let bloom = sin(time * (1.4 + audio.w * 0.6) + dot(uv, uv) * 3.7);
  let baseColor = mix(layer.backgroundColor.rgb, layer.primaryColor.rgb, 0.5 + 0.5 * swirl);
  let accent = mix(layer.primaryColor.rgb, layer.secondaryColor.rgb, 0.5 + 0.5 * uv.y);
  let intensity = 0.65 + layer.intensities.x * 0.5 + audio.w * 0.35;
  var finalColor = mix(baseColor, accent, 0.35) + vec3<f32>(bloom * 0.08);
  let glitch = layer.intensities.y * (1.0 - clamp(glass.metrics.z, 0.0, 1.0));
  if (glitch > 0.001) {
    finalColor += vec3<f32>(glitch * 0.55, glitch * 0.32, glitch * 0.48);
  }
  return vec4<f32>(finalColor * intensity, 1.0);
}
`;

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
}

export function createGlassPipelines(options: GlassPipelineFactoryOptions): GlassPipelineResources {
  const { device, composer, layers, outputFormat, layerShaderCode } = options;

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

  const layerShaderModule = device.createShaderModule({ label: 'LayerShader', code: layerShaderCode ?? LAYER_SHADER });
  const compositeShaderModule = device.createShaderModule({
    label: 'CompositeShader',
    code: buildCompositeShader(layers.length)
  });

  const layerPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [uniformBindGroupLayout, layerBindGroupLayout]
  });

  const compositePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [uniformBindGroupLayout, compositeBindGroupLayout]
  });

  const layerPipeline = device.createRenderPipeline({
    label: 'GlassLayerPipeline',
    layout: layerPipelineLayout,
    vertex: { module: layerShaderModule, entryPoint: 'vsMain' },
    fragment: {
      module: layerShaderModule,
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
  });

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

  return {
    uniformBindGroupLayout,
    layerBindGroupLayout,
    compositeBindGroupLayout,
    layerPipeline,
    compositePipeline,
    sampler
  };
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
