import { GPU_BUFFER_USAGE_COPY_DST, GPU_BUFFER_USAGE_UNIFORM, GPU_SHADER_STAGE_FRAGMENT } from './GPUInterfaces.ts';
import type { GPUBufferLike } from './TripleBufferedUniform.ts';
import type { GPUDeviceRaw } from './GPUInterfaces.ts';

export interface BlurPipelineResources {
  readonly pipeline: unknown;
  readonly uniformBindGroupLayout: unknown;
  readonly sourceBindGroupLayout: unknown;
  readonly uniformBuffer: GPUBufferLike;
}

export interface BlurUniformData {
  readonly direction: readonly [number, number];
  readonly texelSize: readonly [number, number];
  readonly radius: number;
  readonly sigma?: number;
}

const BLUR_SHADER = `
struct BlurUniforms {
  direction : vec2<f32>;
  texelSize : vec2<f32>;
  radius    : f32;
  sigma     : f32;
};

struct VSOutput {
  @builtin(position) position : vec4<f32>;
  @location(0) uv : vec2<f32>;
};

@group(0) @binding(0) var<uniform> blur : BlurUniforms;
@group(1) @binding(0) var blurSampler : sampler;
@group(1) @binding(1) var blurTexture : texture_2d<f32>;

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
  output.uv = uvs[vertexIndex] * 0.5;
  return output;
}

@fragment
fn fsMain(input : VSOutput) -> @location(0) vec4<f32> {
  let radius = i32(max(blur.radius, 0.0));
  let sigma = max(blur.sigma, 0.0001);
  let invTwoSigmaSq = 0.5 / (sigma * sigma);
  var accum = vec4<f32>(0.0);
  var weightSum = 0.0;
  for (var i = -radius; i <= radius; i = i + 1) {
    let offset = f32(i);
    let weight = exp(-offset * offset * invTwoSigmaSq);
    let sampleUv = input.uv + blur.direction * blur.texelSize * offset;
    sampleUv = clamp(sampleUv, vec2<f32>(0.0), vec2<f32>(1.0));
    let sample = textureSampleLevel(blurTexture, blurSampler, sampleUv, 0.0);
    accum = accum + sample * weight;
    weightSum = weightSum + weight;
  }
  return vec4<f32>(accum.rgb / max(weightSum, 1e-4), accum.a / max(weightSum, 1e-4));
}
`;

export function createSeparableBlurPipeline(device: GPUDeviceRaw, format: string): BlurPipelineResources {
  const uniformBindGroupLayout = device.createBindGroupLayout({
    label: 'GlassBlurUniforms',
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_FRAGMENT,
        buffer: { type: 'uniform' }
      }
    ]
  });

  const sourceBindGroupLayout = device.createBindGroupLayout({
    label: 'GlassBlurSource',
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_FRAGMENT,
        sampler: { type: 'filtering' }
      },
      {
        binding: 1,
        visibility: GPU_SHADER_STAGE_FRAGMENT,
        texture: { sampleType: 'float' }
      }
    ]
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [uniformBindGroupLayout, sourceBindGroupLayout]
  });

  const shaderModule = device.createShaderModule({
    label: 'GlassSeparableBlur',
    code: BLUR_SHADER
  });

  const pipeline = device.createRenderPipeline({
    label: 'GlassBlurPipeline',
    layout: pipelineLayout,
    vertex: { module: shaderModule, entryPoint: 'vsMain' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fsMain',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' }
          }
        }
      ]
    },
    primitive: { topology: 'triangle-list' }
  });

  const uniformBuffer = device.createBuffer({
    label: 'GlassBlurUniformBuffer',
    size: Float32Array.BYTES_PER_ELEMENT * 8,
    usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST
  }) as GPUBufferLike;

  return { pipeline, uniformBindGroupLayout, sourceBindGroupLayout, uniformBuffer };
}

export function writeBlurUniforms(device: GPUDeviceRaw, buffer: GPUBufferLike, data: BlurUniformData): void {
  const sigma = data.sigma ?? Math.max(data.radius, 1) * 0.5;
  const payload = new Float32Array([
    data.direction[0], data.direction[1],
    data.texelSize[0], data.texelSize[1],
    data.radius, sigma,
    0, 0,
  ]);
  device.queue.writeBuffer(buffer, 0, payload);
}
