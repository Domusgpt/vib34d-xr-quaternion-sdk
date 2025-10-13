export const GLASS_GEOMETRY_MODES = ['hypercube', 'hypersphere', 'hypertetrahedron'] as const;
export type GlassGeometryMode = typeof GLASS_GEOMETRY_MODES[number];

export const GLASS_PROJECTION_MODES = ['perspective', 'orthographic', 'stereographic'] as const;
export type GlassProjectionMode = typeof GLASS_PROJECTION_MODES[number];

const geometryIndex = new Map<GlassGeometryMode, number>(
  GLASS_GEOMETRY_MODES.map((mode, index) => [mode, index] as const),
);

const projectionIndex = new Map<GlassProjectionMode, number>(
  GLASS_PROJECTION_MODES.map((mode, index) => [mode, index] as const),
);

export function geometryModeToIndex(mode: GlassGeometryMode): number {
  return geometryIndex.get(mode) ?? 0;
}

export function projectionModeToIndex(mode: GlassProjectionMode): number {
  return projectionIndex.get(mode) ?? 0;
}

export interface GlassLayerShaderConfig {
  readonly geometry?: GlassGeometryMode;
  readonly projection?: GlassProjectionMode;
}

const COMMON_SHADER_PREAMBLE = `
struct GlassUniforms {
  leftViewProj : mat4x4<f32>;
  rightViewProj : mat4x4<f32>;
  headMatrix : mat4x4<f32>;
  rotor4d : vec4<f32>;
  euler : vec4<f32>;
  metrics : vec4<f32>;
  audio : vec4<f32>;
  localization : vec4<f32>;
  visual : vec4<f32>;
  materialScalarsA : vec4<f32>;
  materialScalarsB : vec4<f32>;
  materialScalarsC : vec4<f32>;
  materialPrimary : vec4<f32>;
  materialSecondary : vec4<f32>;
  materialBackground : vec4<f32>;
};

struct LayerUniforms {
  color : vec4<f32>;
};

struct VSOutput {
  @builtin(position) position : vec4<f32>;
  @location(0) uv : vec2<f32>;
};

struct ShaderContext {
  dimension : f32;
  morphFactor : f32;
  rotationSpeed : f32;
  universeModifier : f32;
  gridDensity : f32;
  lineThickness : f32;
  shellWidth : f32;
  tetraThickness : f32;
  audioBass : f32;
  audioMid : f32;
  audioHigh : f32;
  time : f32;
};

@group(0) @binding(0) var<uniform> glass : GlassUniforms;
@group(1) @binding(0) var<uniform> layer : LayerUniforms;

fn rotXW(a : f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(c, 0.0, 0.0, s),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(-s, 0.0, 0.0, c),
  );
}

fn rotYW(a : f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, c, 0.0, -s),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(0.0, s, 0.0, c),
  );
}

fn rotZW(a : f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, c, -s),
    vec4<f32>(0.0, 0.0, s, c),
  );
}

fn rotXY(a : f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(c, s, 0.0, 0.0),
    vec4<f32>(-s, c, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0),
  );
}

fn rotYZ(a : f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, c, -s, 0.0),
    vec4<f32>(0.0, s, c, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0),
  );
}

fn rotXZ(a : f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(c, 0.0, s, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(-s, 0.0, c, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0),
  );
}

fn rgb2hsv(c : vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1e-10;
  return vec3<f32>(
    abs(q.z + (q.w - q.y) / (6.0 * d + e)),
    d / (q.x + e),
    q.x,
  );
}

fn hsv2rgb(c : vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}
`;

const PROJECTION_FUNCTIONS = `
fn project4Dto3D_perspective(p : vec4<f32>, context : ShaderContext) -> vec3<f32> {
  let baseDistance = 2.50;
  let dynamicDistance = max(0.2, baseDistance * (1.0 + context.morphFactor * 0.4 - context.audioMid * 0.35));
  let denominator = dynamicDistance + p.w;
  let w_factor = dynamicDistance / max(0.1, denominator);
  return p.xyz * w_factor;
}

fn project4Dto3D_orthographic(p : vec4<f32>, context : ShaderContext) -> vec3<f32> {
  let orthoP = p.xyz;
  let basePerspectiveDistance = 2.5;
  let dynamicPerspectiveDistance = max(0.2, basePerspectiveDistance * (1.0 - context.audioMid * 0.4));
  let perspDenominator = dynamicPerspectiveDistance + p.w;
  let persp_w_factor = dynamicPerspectiveDistance / max(0.1, perspDenominator);
  let perspP = p.xyz * persp_w_factor;
  let morphT = smoothstep(0.0, 1.0, context.morphFactor);
  return mix(orthoP, perspP, vec3<f32>(morphT));
}

fn project4Dto3D_stereographic(p : vec4<f32>, context : ShaderContext) -> vec3<f32> {
  let basePoleW = -1.50;
  let dynamicPoleW = sign(basePoleW) * max(0.1, abs(basePoleW + context.audioHigh * 0.4 * sign(basePoleW)));
  let denominator = p.w - dynamicPoleW;
  let epsilon = 0.001;
  var projectedP = vec3<f32>(0.0);
  if (abs(denominator) < epsilon) {
    projectedP = normalize(p.xyz + vec3<f32>(epsilon)) * 1000.0;
  } else {
    let scale = (-dynamicPoleW) / denominator;
    projectedP = p.xyz * scale;
  }
  let morphT = smoothstep(0.0, 1.0, context.morphFactor * 0.8);
  let orthoP = p.xyz;
  return mix(projectedP, orthoP, vec3<f32>(morphT));
}

fn project4Dto3D_withMode(p : vec4<f32>, context : ShaderContext, projectionId : i32) -> vec3<f32> {
  switch projectionId {
    case 1: {
      return project4Dto3D_orthographic(p, context);
    }
    case 2: {
      return project4Dto3D_stereographic(p, context);
    }
    default: {
      return project4Dto3D_perspective(p, context);
    }
  }
}
`;

const GEOMETRY_FUNCTIONS = `
fn calculateLatticeHypercube(p : vec3<f32>, context : ShaderContext, projectionId : i32) -> f32 {
  let density = max(0.1, context.gridDensity * 0.6 * (1.0 + context.audioBass * 0.4));
  let cell = fract(p * density * 0.5 + vec3<f32>(0.5)) - vec3<f32>(0.5);
  let cellDistance = max(max(abs(cell.x), abs(cell.y)), abs(cell.z));
  var edges = 1.0 - smoothstep(0.0, max(0.0001, context.lineThickness), cellDistance);
  let dim_factor = smoothstep(3.0, 4.5, context.dimension);
  var lattice3D = pow(max(0.0, edges), max(0.1, context.universeModifier));

  if (dim_factor > 0.01) {
    let w_coord = sin(p.x * 1.3 + p.y * 0.9 - p.z * 0.7 + context.time * 0.3)
      * dim_factor * (0.45 + context.morphFactor * 0.55 + context.audioMid * 0.45);
    var p4d = vec4<f32>(p, w_coord);
    let baseSpeed = max(0.01, context.rotationSpeed);
    let time_rot1 = context.time * 0.32 * baseSpeed + context.audioHigh * 0.25;
    let time_rot2 = context.time * -0.27 * baseSpeed + context.audioBass * 0.2;
    let time_rot3 = context.time * 0.24 * baseSpeed + context.audioMid * 0.2;
    var transformed = rotYW(time_rot3) * p4d;
    transformed = rotZW(time_rot2) * transformed;
    transformed = rotXW(time_rot1) * transformed;
    let projectedP = project4Dto3D_withMode(transformed, context, projectionId);
    let projectedCell = fract(projectedP * density * 0.5 + vec3<f32>(0.5)) - vec3<f32>(0.5);
    let projectedDistance = max(max(abs(projectedCell.x), abs(projectedCell.y)), abs(projectedCell.z));
    let lattice4D = 1.0 - smoothstep(0.0, max(0.0001, context.lineThickness), projectedDistance);
    lattice3D = mix(
      lattice3D,
      pow(max(0.0, lattice4D), max(0.1, context.universeModifier)),
      smoothstep(0.0, 1.0, context.morphFactor),
    );
  }

  return lattice3D;
}

fn calculateLatticeHypersphere(p : vec3<f32>, context : ShaderContext, projectionId : i32) -> f32 {
  let radius3D = length(p);
  let densityFactor = max(0.1, context.gridDensity * 0.7 * (1.0 + context.audioBass * 0.5));
  let dynamicShellWidth = max(0.005, context.shellWidth * (1.0 + context.audioMid * 1.5));
  let phase = radius3D * densityFactor * 6.28318 - context.time * context.rotationSpeed * 0.8 + context.audioHigh * 3.0;
  let shells3D = 0.5 + 0.5 * sin(phase);
  shells3D = smoothstep(1.0 - dynamicShellWidth, 1.0, shells3D);

  var finalLattice = shells3D;
  let dim_factor = smoothstep(3.0, 4.5, context.dimension);

  if (dim_factor > 0.01) {
    let w_coord = cos(radius3D * 2.5 - context.time * 0.55)
      * sin(p.x * 1.0 + p.y * 1.3 - p.z * 0.7 + context.time * 0.2)
      * dim_factor * (0.5 + context.morphFactor * 0.5 + context.audioMid * 0.5);

    var p4d = vec4<f32>(p, w_coord);
    let baseSpeed = context.rotationSpeed * 0.85;
    let time_rot1 = context.time * 0.38 * baseSpeed + context.audioHigh * 0.2;
    let time_rot2 = context.time * 0.31 * baseSpeed + context.morphFactor * 0.6;
    let time_rot3 = context.time * -0.24 * baseSpeed + context.audioBass * 0.25;
    var transformed = rotYW(time_rot3 * 0.95) * p4d;
    transformed = rotYZ(time_rot2) * transformed;
    transformed = rotXW(time_rot1 * 1.05) * transformed;

    let projectedP = project4Dto3D_withMode(transformed, context, projectionId);
    let radius4D_proj = length(projectedP);
    let phase4D = radius4D_proj * densityFactor * 6.28318 - context.time * context.rotationSpeed * 0.8 + context.audioHigh * 3.0;
    let shells4D_proj = 0.5 + 0.5 * sin(phase4D);
    shells4D_proj = smoothstep(1.0 - dynamicShellWidth, 1.0, shells4D_proj);
    finalLattice = mix(shells3D, shells4D_proj, smoothstep(0.0, 1.0, context.morphFactor));
  }

  return pow(max(0.0, finalLattice), max(0.1, context.universeModifier));
}

fn calculateLatticeHypertetrahedron(p : vec3<f32>, context : ShaderContext, projectionId : i32) -> f32 {
  let density = max(0.1, context.gridDensity * 0.65 * (1.0 + context.audioBass * 0.4));
  let dynamicThickness = max(0.003, context.tetraThickness * (1.0 - context.audioMid * 0.7));

  let c1 = normalize(vec3<f32>(1.0, 1.0, 1.0));
  let c2 = normalize(vec3<f32>(-1.0, -1.0, 1.0));
  let c3 = normalize(vec3<f32>(-1.0, 1.0, -1.0));
  let c4 = normalize(vec3<f32>(1.0, -1.0, -1.0));
  let p_mod3D = fract(p * density * 0.5 + vec3<f32>(0.5) + context.time * 0.005) - vec3<f32>(0.5);
  let d1 = dot(p_mod3D, c1);
  let d2 = dot(p_mod3D, c2);
  let d3 = dot(p_mod3D, c3);
  let d4 = dot(p_mod3D, c4);
  let minDistToPlane3D = min(min(abs(d1), abs(d2)), min(abs(d3), abs(d4)));
  let lattice3D = 1.0 - smoothstep(0.0, dynamicThickness, minDistToPlane3D);

  var finalLattice = lattice3D;
  let dim_factor = smoothstep(3.0, 4.5, context.dimension);

  if (dim_factor > 0.01) {
    let w_coord = cos(p.x * 1.8 - p.y * 1.5 + p.z * 1.2 + context.time * 0.24)
      * sin(length(p) * 1.4 + context.time * 0.18 - context.audioMid * 2.0)
      * dim_factor * (0.45 + context.morphFactor * 0.55 + context.audioHigh * 0.4);
    var p4d = vec4<f32>(p, w_coord);
    let baseSpeed = context.rotationSpeed * 1.15;
    let time_rot1 = context.time * 0.28 * baseSpeed + context.audioHigh * 0.25;
    let time_rot2 = context.time * 0.36 * baseSpeed - context.audioBass * 0.2 + context.morphFactor * 0.4;
    let time_rot3 = context.time * 0.32 * baseSpeed + context.audioMid * 0.15;
    var transformed = rotZW(time_rot3) * p4d;
    transformed = rotYW(time_rot2 * 1.05) * transformed;
    transformed = rotXW(time_rot1 * 0.95) * transformed;
    let projectedP = project4Dto3D_withMode(transformed, context, projectionId);

    let p_mod4D_proj = fract(projectedP * density * 0.5 + vec3<f32>(0.5) + context.time * 0.008) - vec3<f32>(0.5);
    let dp1 = dot(p_mod4D_proj, c1);
    let dp2 = dot(p_mod4D_proj, c2);
    let dp3 = dot(p_mod4D_proj, c3);
    let dp4 = dot(p_mod4D_proj, c4);
    let minDistToPlane4D = min(min(abs(dp1), abs(dp2)), min(abs(dp3), abs(dp4)));
    let lattice4D_proj = 1.0 - smoothstep(0.0, dynamicThickness, minDistToPlane4D);
    finalLattice = mix(lattice3D, lattice4D_proj, smoothstep(0.0, 1.0, context.morphFactor));
  }

  return pow(max(0.0, finalLattice), max(0.1, context.universeModifier));
}

fn calculateLattice(p : vec3<f32>, context : ShaderContext, projectionId : i32, geometryId : i32) -> f32 {
  switch geometryId {
    case 1: {
      return calculateLatticeHypersphere(p, context, projectionId);
    }
    case 2: {
      return calculateLatticeHypertetrahedron(p, context, projectionId);
    }
    default: {
      return calculateLatticeHypercube(p, context, projectionId);
    }
  }
}
`;

const VERTEX_STAGE = `
@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VSOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
    vec2<f32>(0.0, 2.0),
  );
  var output : VSOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}
`;

const FRAGMENT_STAGE = `
@fragment
fn fsMain(input : VSOutput) -> @location(0) vec4<f32> {
  let resolution = vec2<f32>(glass.materialScalarsC.x, max(glass.materialScalarsC.y, 1e-3));
  let aspect = max(glass.materialScalarsC.z, 1e-3);
  let projectionId = i32(round(glass.materialScalarsC.w));
  let geometryId = i32(round(glass.materialScalarsB.w));

  let uv = (input.uv * 2.0 - vec2<f32>(1.0)) * vec2<f32>(aspect, 1.0);
  let rayOrigin = vec3<f32>(0.0, 0.0, -2.5);
  var rayDirection = normalize(vec3<f32>(uv, 1.0));

  let time = glass.metrics.x;
  let rotationSpeed = glass.visual.z;
  let camRotY = time * 0.05 * rotationSpeed + glass.audio.y * 0.1;
  let camRotX = sin(time * 0.03 * rotationSpeed) * 0.15 + glass.audio.z * 0.1;
  let camMat = rotXY(camRotX) * rotYZ(camRotY);
  rayDirection = (camMat * vec4<f32>(rayDirection, 0.0)).xyz;

  var context = ShaderContext(
    glass.visual.x,
    glass.visual.y,
    rotationSpeed,
    glass.visual.w,
    glass.materialScalarsA.x,
    glass.materialScalarsA.y,
    glass.materialScalarsA.z,
    glass.materialScalarsA.w,
    glass.audio.x,
    glass.audio.y,
    glass.audio.z,
    time,
  );

  let p = rayDirection * 1.5;
  let latticeValue = calculateLattice(p, context, projectionId, geometryId);

  var color = mix(glass.materialBackground.xyz, glass.materialPrimary.xyz, vec3<f32>(latticeValue));
  color = mix(
    color,
    glass.materialSecondary.xyz,
    vec3<f32>(smoothstep(0.2, 0.7, glass.audio.y) * latticeValue * 0.6),
  );

  if (abs(glass.materialScalarsB.z) > 0.01) {
    var hsv = rgb2hsv(color);
    hsv.x = fract(hsv.x + glass.materialScalarsB.z * 0.5 + glass.audio.z * 0.1);
    color = hsv2rgb(hsv);
  }

  color *= (0.8 + glass.materialScalarsB.x * 0.7);

  if (glass.materialScalarsB.y > 0.001) {
    let glitch = glass.materialScalarsB.y * (0.5 + 0.5 * sin(time * 8.0 + p.y * 10.0));
    let aspectVec = vec2<f32>(aspect, 1.0);
    let offsetR = vec2<f32>(cos(time * 25.0), sin(time * 18.0 + p.x * 5.0)) * glitch * 0.2 * aspectVec;
    let offsetB = vec2<f32>(sin(time * 19.0 + p.y * 6.0), cos(time * 28.0)) * glitch * 0.15 * aspectVec;

    var pR = normalize(vec3<f32>((input.uv + offsetR) * 2.0 - vec2<f32>(1.0), 1.0));
    pR = (camMat * vec4<f32>(pR, 0.0)).xyz * 1.5;
    var pB = normalize(vec3<f32>((input.uv + offsetB) * 2.0 - vec2<f32>(1.0), 1.0));
    pB = (camMat * vec4<f32>(pB, 0.0)).xyz * 1.5;

    let latticeR = calculateLattice(pR, context, projectionId, geometryId);
    let latticeB = calculateLattice(pB, context, projectionId, geometryId);

    var colorR = mix(glass.materialBackground.xyz, glass.materialPrimary.xyz, vec3<f32>(latticeR));
    colorR = mix(
      colorR,
      glass.materialSecondary.xyz,
      vec3<f32>(smoothstep(0.2, 0.7, glass.audio.y) * latticeR * 0.6),
    );
    var colorB = mix(glass.materialBackground.xyz, glass.materialPrimary.xyz, vec3<f32>(latticeB));
    colorB = mix(
      colorB,
      glass.materialSecondary.xyz,
      vec3<f32>(smoothstep(0.2, 0.7, glass.audio.y) * latticeB * 0.6),
    );

    if (abs(glass.materialScalarsB.z) > 0.01) {
      var hsvR = rgb2hsv(colorR);
      hsvR.x = fract(hsvR.x + glass.materialScalarsB.z * 0.5 + glass.audio.z * 0.1);
      colorR = hsv2rgb(hsvR);
      var hsvB = rgb2hsv(colorB);
      hsvB.x = fract(hsvB.x + glass.materialScalarsB.z * 0.5 + glass.audio.z * 0.1);
      colorB = hsv2rgb(hsvB);
    }

    color = vec3<f32>(colorR.r, color.g, colorB.b);
    color *= (0.8 + glass.materialScalarsB.x * 0.7);
  }

  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.5)), vec3<f32>(0.9));
  let layerInfluence = layer.color;
  let tint = mix(vec3<f32>(1.0), layerInfluence.rgb, vec3<f32>(layerInfluence.a));
  return vec4<f32>(color * tint, 1.0);
}
`;

export function buildGlassLayerShader(config: GlassLayerShaderConfig = {}): string {
  const shaderParts = [
    COMMON_SHADER_PREAMBLE,
    PROJECTION_FUNCTIONS,
    GEOMETRY_FUNCTIONS,
    VERTEX_STAGE,
    FRAGMENT_STAGE,
  ];
  return shaderParts.join('\n');
}

