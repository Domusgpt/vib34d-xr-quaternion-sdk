export type GlassGeometryModule = 'hypercube' | 'hypersphere' | 'hypertetrahedron';
export type GlassProjectionModule = 'perspective' | 'orthographic' | 'stereographic';

const COMMON_MATH = `
fn rotXW(a: f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>( c, 0.0, 0.0, -s),
    vec4<f32>(0.0, 1.0, 0.0,  0.0),
    vec4<f32>(0.0, 0.0, 1.0,  0.0),
    vec4<f32>( s, 0.0, 0.0,  c)
  );
}

fn rotYW(a: f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0,  c, 0.0, -s),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(0.0,  s, 0.0,  c)
  );
}

fn rotZW(a: f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0,  c, -s),
    vec4<f32>(0.0, 0.0,  s,  c)
  );
}

fn rotXY(a: f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>( c, -s, 0.0, 0.0),
    vec4<f32>( s,  c, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

fn rotYZ(a: f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0,  c, -s, 0.0),
    vec4<f32>(0.0,  s,  c, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

fn rotXZ(a: f32) -> mat4x4<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat4x4<f32>(
    vec4<f32>( c, 0.0, -s, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>( s, 0.0,  c, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  var p = vec4<f32>(c.g, c.b, K.x, K.y);
  if (c.g < c.b) {
    p = vec4<f32>(c.b, c.g, K.w, K.z);
  }
  var q = vec4<f32>(p.x, p.y, p.w, c.r);
  if (p.x < c.r) {
    q = vec4<f32>(c.r, p.y, p.z, p.x);
  }
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  let hue = abs(q.z + (q.w - q.y) / (6.0 * d + e));
  let sat = d / (q.x + e);
  return vec3<f32>(hue, sat, q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(c.x, c.x, c.x) + K.xyz) * 6.0 - K.www);
  return c.z * mix(vec3<f32>(K.xxx), clamp(p - vec3<f32>(K.xxx), vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0)), c.y);
}
`;

const PROJECTION_SNIPPETS: Record<GlassProjectionModule, string> = {
  perspective: `
fn project4Dto3D(p: vec4<f32>) -> vec3<f32> {
  let baseDistance = 2.5;
  let morph = clamp(glass.visual.y, 0.0, 1.0);
  let midBand = clamp(glass.audio.y, 0.0, 1.0);
  let dynamicDistance = max(0.2, baseDistance * (1.0 + morph * 0.4 - midBand * 0.35));
  let denominator = dynamicDistance + p.w;
  let wFactor = dynamicDistance / max(0.1, denominator);
  return p.xyz * wFactor;
}
`,
  orthographic: `
fn project4Dto3D(p: vec4<f32>) -> vec3<f32> {
  let ortho = p.xyz;
  let basePerspective = 2.5;
  let midBand = clamp(glass.audio.y, 0.0, 1.0);
  let morph = clamp(glass.visual.y, 0.0, 1.0);
  let dynamicPerspective = max(0.2, basePerspective * (1.0 - midBand * 0.4));
  let denominator = dynamicPerspective + p.w;
  let perspective = p.xyz * (dynamicPerspective / max(0.1, denominator));
  return mix(ortho, perspective, morph);
}
`,
  stereographic: `
fn project4Dto3D(p: vec4<f32>) -> vec3<f32> {
  let basePole = -1.5;
  let audioHigh = clamp(glass.audio.z, 0.0, 1.0);
  let dynamicPole = sign(basePole) * max(0.1, abs(basePole + audioHigh * 0.4 * sign(basePole)));
  let denominator = p.w - dynamicPole;
  let epsilon = 0.001;
  var projected = vec3<f32>(0.0, 0.0, 0.0);
  if (abs(denominator) < epsilon) {
    projected = normalize(p.xyz + vec3<f32>(epsilon)) * 1000.0;
  } else {
    let scale = (-dynamicPole) / denominator;
    projected = p.xyz * scale;
  }
  let morph = clamp(glass.visual.y * 0.8, 0.0, 1.0);
  return mix(projected, p.xyz, morph);
}
`,
};

const GEOMETRY_SNIPPETS: Record<GlassGeometryModule, string> = {
  hypercube: `
fn calculateLattice(p: vec3<f32>) -> f32 {
  let u_gridDensity = max(0.1, layer.lattice.x * (1.0 + glass.audio.x * 0.4));
  let u_lineThickness = max(0.0001, layer.lattice.y);
  let u_dimension = glass.visual.x;
  let u_morphFactor = clamp(glass.visual.y, 0.0, 1.0);
  let u_rotationSpeed = max(0.01, glass.visual.z);
  let u_universeModifier = max(0.1, glass.visual.w);
  let cell = fract(p * u_gridDensity * 0.5 + vec3<f32>(0.5, 0.5, 0.5)) - vec3<f32>(0.5, 0.5, 0.5);
  let cellDistance = max(max(abs(cell.x), abs(cell.y)), abs(cell.z));
  var lattice3D = pow(max(0.0, 1.0 - smoothstep(0.0, u_lineThickness, cellDistance)), u_universeModifier);
  let dimFactor = smoothstep(3.0, 4.5, u_dimension);
  if (dimFactor > 0.01) {
    let wCoord = sin(p.x * 1.3 + p.y * 0.9 - p.z * 0.7 + glass.metrics.x * 0.3)
      * dimFactor * (0.45 + u_morphFactor * 0.55 + glass.audio.y * 0.45);
    var p4d = vec4<f32>(p, wCoord);
    let timeRot1 = glass.metrics.x * 0.32 * u_rotationSpeed + glass.audio.z * 0.25;
    let timeRot2 = glass.metrics.x * -0.27 * u_rotationSpeed + glass.audio.x * 0.2;
    let timeRot3 = glass.metrics.x * 0.24 * u_rotationSpeed + glass.audio.y * 0.2;
    p4d = rotXW(timeRot1) * rotZW(timeRot2) * rotYW(timeRot3) * p4d;
    let projected = project4Dto3D(p4d);
    let projectedCell = fract(projected * u_gridDensity * 0.5 + vec3<f32>(0.5, 0.5, 0.5)) - vec3<f32>(0.5, 0.5, 0.5);
    let projectedDistance = max(max(abs(projectedCell.x), abs(projectedCell.y)), abs(projectedCell.z));
    let lattice4D = pow(max(0.0, 1.0 - smoothstep(0.0, u_lineThickness, projectedDistance)), u_universeModifier);
    lattice3D = mix(lattice3D, lattice4D, smoothstep(0.0, 1.0, u_morphFactor));
  }
  return lattice3D;
}
`,
  hypersphere: `
fn calculateLattice(p: vec3<f32>) -> f32 {
  let densityFactor = max(0.1, layer.lattice.x * 0.7 * (1.0 + glass.audio.x * 0.5));
  let dynamicShellWidth = max(0.005, layer.lattice.z * (1.0 + glass.audio.y * 1.5));
  let radius3D = length(p);
  let timeFactor = glass.metrics.x * glass.visual.z * 0.8;
  let shells3D = 0.5 + 0.5 * sin(radius3D * densityFactor * 6.28318 - timeFactor + glass.audio.z * 3.0);
  shells3D = smoothstep(1.0 - dynamicShellWidth, 1.0, shells3D);
  var finalLattice = shells3D;
  let dimFactor = smoothstep(3.0, 4.5, glass.visual.x);
  if (dimFactor > 0.01) {
    let wCoord = cos(radius3D * 2.5 - glass.metrics.x * 0.55)
      * sin(p.x * 1.0 + p.y * 1.3 - p.z * 0.7 + glass.metrics.x * 0.2)
      * dimFactor * (0.5 + glass.visual.y * 0.5 + glass.audio.y * 0.5);
    var p4d = vec4<f32>(p, wCoord);
    let baseSpeed = glass.visual.z * 0.85;
    let timeRot1 = glass.metrics.x * 0.38 * baseSpeed + glass.audio.z * 0.2;
    let timeRot2 = glass.metrics.x * 0.31 * baseSpeed + glass.visual.y * 0.6;
    let timeRot3 = glass.metrics.x * -0.24 * baseSpeed + glass.audio.x * 0.25;
    p4d = rotXW(timeRot1 * 1.05) * rotYZ(timeRot2) * rotYW(timeRot3 * 0.95) * p4d;
    let projected = project4Dto3D(p4d);
    let radiusProj = length(projected);
    let phase4D = radiusProj * densityFactor * 6.28318 - timeFactor + glass.audio.z * 3.0;
    let shells4D = 0.5 + 0.5 * sin(phase4D);
    shells4D = smoothstep(1.0 - dynamicShellWidth, 1.0, shells4D);
    finalLattice = mix(shells3D, shells4D, smoothstep(0.0, 1.0, glass.visual.y));
  }
  return pow(max(0.0, finalLattice), max(0.1, glass.visual.w));
}
`,
  hypertetrahedron: `
fn calculateLattice(p: vec3<f32>) -> f32 {
  let density = max(0.1, layer.lattice.x * 0.65 * (1.0 + glass.audio.x * 0.4));
  let dynamicThickness = max(0.003, layer.lattice.w * (1.0 - glass.audio.y * 0.7));
  let c1 = normalize(vec3<f32>( 1.0,  1.0,  1.0));
  let c2 = normalize(vec3<f32>(-1.0, -1.0,  1.0));
  let c3 = normalize(vec3<f32>(-1.0,  1.0, -1.0));
  let c4 = normalize(vec3<f32>( 1.0, -1.0, -1.0));
  let pMod = fract(p * density * 0.5 + vec3<f32>(0.5, 0.5, 0.5) + glass.metrics.x * 0.005) - vec3<f32>(0.5, 0.5, 0.5);
  let d1 = dot(pMod, c1);
  let d2 = dot(pMod, c2);
  let d3 = dot(pMod, c3);
  let d4 = dot(pMod, c4);
  let minDist3D = min(min(abs(d1), abs(d2)), min(abs(d3), abs(d4)));
  let lattice3D = 1.0 - smoothstep(0.0, dynamicThickness, minDist3D);
  var finalLattice = lattice3D;
  let dimFactor = smoothstep(3.0, 4.5, glass.visual.x);
  if (dimFactor > 0.01) {
    let wCoord = cos(p.x * 1.8 - p.y * 1.5 + p.z * 1.2 + glass.metrics.x * 0.24)
      * sin(length(p) * 1.4 + glass.metrics.x * 0.18 - glass.audio.y * 2.0)
      * dimFactor * (0.45 + glass.visual.y * 0.55 + glass.audio.z * 0.4);
    var p4d = vec4<f32>(p, wCoord);
    let baseSpeed = glass.visual.z * 1.15;
    let timeRot1 = glass.metrics.x * 0.28 * baseSpeed + glass.audio.z * 0.25;
    let timeRot2 = glass.metrics.x * 0.36 * baseSpeed - glass.audio.x * 0.2 + glass.visual.y * 0.4;
    let timeRot3 = glass.metrics.x * 0.32 * baseSpeed + glass.audio.y * 0.15;
    p4d = rotXW(timeRot1 * 0.95) * rotYW(timeRot2 * 1.05) * rotZW(timeRot3) * p4d;
    let projected = project4Dto3D(p4d);
    let pModProj = fract(projected * density * 0.5 + vec3<f32>(0.5, 0.5, 0.5) + glass.metrics.x * 0.008) - vec3<f32>(0.5, 0.5, 0.5);
    let dp1 = dot(pModProj, c1);
    let dp2 = dot(pModProj, c2);
    let dp3 = dot(pModProj, c3);
    let dp4 = dot(pModProj, c4);
    let minDist4D = min(min(abs(dp1), abs(dp2)), min(abs(dp3), abs(dp4)));
    let lattice4D = 1.0 - smoothstep(0.0, dynamicThickness, minDist4D);
    finalLattice = mix(lattice3D, lattice4D, smoothstep(0.0, 1.0, glass.visual.y));
  }
  return pow(max(0.0, finalLattice), max(0.1, glass.visual.w));
}
`,
};

export interface GlassShaderBuilderOptions {
  readonly geometry: GlassGeometryModule;
  readonly projection: GlassProjectionModule;
}

export function buildGlassLayerShader(options: GlassShaderBuilderOptions): string {
  const geometry = options.geometry ?? 'hypercube';
  const projection = options.projection ?? 'perspective';
  const geometryCode = GEOMETRY_SNIPPETS[geometry];
  const projectionCode = PROJECTION_SNIPPETS[projection];

  if (!geometryCode) {
    throw new Error(`Unknown glass geometry module: ${geometry}`);
  }
  if (!projectionCode) {
    throw new Error(`Unknown glass projection module: ${projection}`);
  }

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

${COMMON_MATH}
${projectionCode}
${geometryCode}

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
  var rayDirection = normalize(vec3<f32>(uv, 1.0));
  let time = glass.metrics.x;
  let rotationSpeed = max(0.01, glass.visual.z);
  let audioMid = clamp(glass.audio.y, 0.0, 1.0);
  let audioHigh = clamp(glass.audio.z, 0.0, 1.0);
  let camRotY = time * 0.05 * rotationSpeed + audioMid * 0.1;
  let camRotX = sin(time * 0.03 * rotationSpeed) * 0.15 + audioHigh * 0.1;
  let camMat = rotXY(camRotX) * rotYZ(camRotY);
  rayDirection = (camMat * vec4<f32>(rayDirection, 0.0)).xyz;
  let p = rayDirection * 1.5;
  let latticeValue = calculateLattice(p);
  var color = mix(layer.backgroundColor.rgb, layer.primaryColor.rgb, latticeValue);
  color = mix(color, layer.secondaryColor.rgb, smoothstep(0.2, 0.7, audioMid) * latticeValue * 0.6);
  let patternIntensity = layer.intensities.x;
  let glitchIntensity = layer.intensities.y;
  let colorShift = layer.intensities.z;
  if (abs(colorShift) > 0.01) {
    var hsv = rgb2hsv(color);
    hsv.x = fract(hsv.x + colorShift * 0.5 + audioHigh * 0.1);
    color = hsv2rgb(hsv);
  }
  color = color * (0.8 + patternIntensity * 0.7);
  if (glitchIntensity > 0.001) {
    let glitch = glitchIntensity * (0.5 + 0.5 * sin(time * 8.0 + p.y * 10.0));
    let offsetR = vec2<f32>(cos(time * 25.0), sin(time * 18.0 + p.x * 5.0)) * glitch * 0.2 * vec2<f32>(aspect, 1.0);
    let offsetB = vec2<f32>(sin(time * 19.0 + p.y * 6.0), cos(time * 28.0)) * glitch * 0.15 * vec2<f32>(aspect, 1.0);
    var pR = normalize(vec3<f32>(uv + offsetR / vec2<f32>(aspect, 1.0), 1.0));
    pR = (camMat * vec4<f32>(pR, 0.0)).xyz * 1.5;
    var pB = normalize(vec3<f32>(uv + offsetB / vec2<f32>(aspect, 1.0), 1.0));
    pB = (camMat * vec4<f32>(pB, 0.0)).xyz * 1.5;
    let latticeR = calculateLattice(pR);
    let latticeB = calculateLattice(pB);
    var colorR = mix(layer.backgroundColor.rgb, layer.primaryColor.rgb, latticeR);
    colorR = mix(colorR, layer.secondaryColor.rgb, smoothstep(0.2, 0.7, audioMid) * latticeR * 0.6);
    var colorB = mix(layer.backgroundColor.rgb, layer.primaryColor.rgb, latticeB);
    colorB = mix(colorB, layer.secondaryColor.rgb, smoothstep(0.2, 0.7, audioMid) * latticeB * 0.6);
    if (abs(colorShift) > 0.01) {
      var hsvR = rgb2hsv(colorR);
      hsvR.x = fract(hsvR.x + colorShift * 0.5 + audioHigh * 0.1);
      colorR = hsv2rgb(hsvR);
      var hsvB = rgb2hsv(colorB);
      hsvB.x = fract(hsvB.x + colorShift * 0.5 + audioHigh * 0.1);
      colorB = hsv2rgb(hsvB);
    }
    color = vec3<f32>(colorR.r, color.g, colorB.b);
    color = color * (0.8 + patternIntensity * 0.7);
  }
  color = pow(clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.5, 1.5, 1.5)), vec3<f32>(0.9, 0.9, 0.9));
  return vec4<f32>(color, 1.0);
}
`;
}

export default buildGlassLayerShader;
