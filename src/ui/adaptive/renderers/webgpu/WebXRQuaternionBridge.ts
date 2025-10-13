import { deriveRotorSnapshot, normalize as normalizeQuaternionTuple } from '../../../../core/quaternion/index.ts';
import type { Quaternion } from '../../../../core/quaternion/index.ts';
import {
  GlassUniformLayout,
  createFloat32ArrayForLayout,
  writeField,
} from './BufferLayout.ts';
import type { MultiLayerGlassComposer } from './MultiLayerGlassComposer.ts';
import {
  GLASS_GEOMETRY_MODES,
  GLASS_PROJECTION_MODES,
  geometryModeToIndex,
  projectionModeToIndex,
  type GlassGeometryMode,
  type GlassProjectionMode,
} from './shaders/GlassLayerShaderBuilder.ts';

export interface QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface XRTransformLike {
  readonly orientation?: QuaternionLike;
  readonly position?: Vec3Like;
  readonly matrix?: readonly number[] | Float32Array;
  readonly inverse?: { readonly matrix: readonly number[] | Float32Array };
}

export interface XRViewLike {
  readonly projectionMatrix?: readonly number[] | Float32Array;
  readonly transform: XRTransformLike;
}

export interface XRViewerPoseLike {
  readonly views: readonly XRViewLike[];
  readonly transform?: XRTransformLike;
}

export interface XRFrameLike {
  getViewerPose(referenceSpace: unknown): XRViewerPoseLike | null;
}

export interface AudioBands {
  readonly bass?: number;
  readonly mid?: number;
  readonly high?: number;
  readonly energy?: number;
}

export interface VisualParameterVector {
  readonly dimension?: number;
  readonly morphFactor?: number;
  readonly rotationSpeed?: number;
  readonly universeModifier?: number;
}

export interface MaterialUniformOptions {
  readonly gridDensity?: number;
  readonly lineThickness?: number;
  readonly shellWidth?: number;
  readonly tetraThickness?: number;
  readonly patternIntensity?: number;
  readonly glitchIntensity?: number;
  readonly colorShift?: number;
  readonly geometry?: number | GlassGeometryMode;
  readonly projection?: number | GlassProjectionMode;
  readonly resolution?: readonly [number, number];
}

export interface MaterialPaletteOptions {
  readonly primary?: readonly [number, number, number];
  readonly secondary?: readonly [number, number, number];
  readonly background?: readonly [number, number, number];
}

export interface WebXRQuaternionBridgeOptions {
  readonly composer: MultiLayerGlassComposer;
  readonly uniformFloatCount?: number;
  readonly logger?: { warn?: (...args: unknown[]) => void };
}

export interface UpdateUniformOptions {
  readonly referenceSpace: unknown;
  readonly frameTime: number;
  readonly deltaTime?: number;
  readonly audio?: AudioBands;
  readonly confidence?: number;
  readonly visualParams?: VisualParameterVector;
  readonly rotorOverride?: readonly [number, number, number];
  readonly localization?: LocalizationUniformPayload;
  readonly material?: MaterialUniformOptions;
  readonly palette?: MaterialPaletteOptions;
}

export interface LocalizationUniformPayload {
  readonly stageConfidence?: number;
  readonly anchorConfidence?: number;
  readonly drift?: number;
  readonly latencySeconds?: number;
  readonly latencyMs?: number;
}

const IDENTITY_MATRIX4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]) as const;

const MIN_UNIFORM_FLOAT_COUNT = GlassUniformLayout.byteSize / Float32Array.BYTES_PER_ELEMENT;

function getMatrix4(source?: readonly number[] | Float32Array): number[] {
  if (!source || source.length !== 16) {
    return [...IDENTITY_MATRIX4];
  }
  return Array.from(source, value => Number(value) || 0);
}

function multiplyMat4(a: readonly number[], b: readonly number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      result[row * 4 + col] = sum;
    }
  }
  return result;
}

function quaternionFromLike(source?: QuaternionLike | null): Quaternion | null {
  if (!source) {
    return null;
  }
  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  const w = Number(source.w);
  if ([x, y, z, w].some(value => Number.isNaN(value))) {
    return null;
  }
  return normalizeQuaternionTuple([x, y, z, w]);
}

function vec3FromLike(source?: Vec3Like | null): [number, number, number] {
  if (!source) {
    return [0, 0, 0];
  }
  return [Number(source.x) || 0, Number(source.y) || 0, Number(source.z) || 0];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function resolveAudioBands(bands?: AudioBands): [number, number, number, number] {
  const bass = clamp01(bands?.bass ?? 0);
  const mid = clamp01(bands?.mid ?? 0);
  const high = clamp01(bands?.high ?? 0);
  const energy = clamp01(bands?.energy ?? Math.max(bass, mid, high));
  return [bass, mid, high, energy];
}

function resolveVisualParams(params?: VisualParameterVector): [number, number, number, number] {
  return [
    Number(params?.dimension) || 0,
    Number(params?.morphFactor) || 0,
    Number(params?.rotationSpeed) || 0,
    Number(params?.universeModifier) || 0
  ];
}

function resolveLocalizationUniform(payload?: LocalizationUniformPayload): [number, number, number, number] {
  if (!payload) {
    return [0, 0, 0, 0];
  }
  const stage = clamp01(payload.stageConfidence ?? 0);
  const anchor = clamp01(payload.anchorConfidence ?? 0);
  const drift = clamp01(payload.drift ?? 0);
  const latencySeconds = payload.latencySeconds ?? (payload.latencyMs != null ? payload.latencyMs / 1000 : 0);
  return [stage, anchor, drift, Math.min(Math.max(latencySeconds, 0), 16)];
}

function resolveGeometryId(value?: number | GlassGeometryMode): number {
  if (typeof value === 'string') {
    return geometryModeToIndex(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = Math.floor(value);
    return Math.max(0, Math.min(GLASS_GEOMETRY_MODES.length - 1, clamped));
  }
  return 0;
}

function resolveProjectionId(value?: number | GlassProjectionMode): number {
  if (typeof value === 'string') {
    return projectionModeToIndex(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = Math.floor(value);
    return Math.max(0, Math.min(GLASS_PROJECTION_MODES.length - 1, clamped));
  }
  return 0;
}

function resolveMaterialScalars(material?: MaterialUniformOptions): {
  scalarsA: [number, number, number, number];
  scalarsB: [number, number, number, number];
  scalarsC: [number, number, number, number];
} {
  const gridDensity = Number(material?.gridDensity ?? 12);
  const lineThickness = Number(material?.lineThickness ?? 0.03);
  const shellWidth = Number(material?.shellWidth ?? 0.025);
  const tetraThickness = Number(material?.tetraThickness ?? 0.035);
  const patternIntensity = Number(material?.patternIntensity ?? 1);
  const glitchIntensity = clamp01(material?.glitchIntensity ?? 0);
  const colorShift = Number(material?.colorShift ?? 0);
  const geometryId = resolveGeometryId(material?.geometry);
  const projectionId = resolveProjectionId(material?.projection);
  const resolution = material?.resolution ?? [1280, 720];
  const width = Math.max(1, Number(resolution[0]) || 1);
  const height = Math.max(1, Number(resolution[1]) || 1);
  const aspect = width / height;
  return {
    scalarsA: [gridDensity, lineThickness, shellWidth, tetraThickness],
    scalarsB: [patternIntensity, glitchIntensity, colorShift, geometryId],
    scalarsC: [width, height, aspect, projectionId],
  };
}

function clampColor(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function resolveColorVector(color: readonly [number, number, number] | undefined, fallback: [number, number, number]): [number, number, number, number] {
  const source = color ?? fallback;
  return [
    clampColor(Number(source[0])),
    clampColor(Number(source[1])),
    clampColor(Number(source[2])),
    1,
  ];
}

function resolveMaterialPalette(palette?: MaterialPaletteOptions): {
  primary: [number, number, number, number];
  secondary: [number, number, number, number];
  background: [number, number, number, number];
} {
  return {
    primary: resolveColorVector(palette?.primary, [1, 0.2, 0.8]),
    secondary: resolveColorVector(palette?.secondary, [0.2, 1, 1]),
    background: resolveColorVector(palette?.background, [0.05, 0, 0.2]),
  };
}

export class WebXRQuaternionBridge {
  static readonly uniformLayout = GlassUniformLayout;
  static readonly uniformByteSize = GlassUniformLayout.byteSize;
  static readonly uniformFloatCount = MIN_UNIFORM_FLOAT_COUNT;

  readonly composer: MultiLayerGlassComposer;
  readonly uniformFloatCount: number;
  readonly uniformArray: Float32Array;
  readonly logger?: { warn?: (...args: unknown[]) => void };

  private lastFrameTime: number | null = null;

  constructor(options: WebXRQuaternionBridgeOptions) {
    if (!options?.composer) {
      throw new Error('WebXRQuaternionBridge requires a MultiLayerGlassComposer instance');
    }
    this.composer = options.composer;
    const requestedFloatCount = Math.floor(options.uniformFloatCount ?? MIN_UNIFORM_FLOAT_COUNT);
    if (requestedFloatCount < MIN_UNIFORM_FLOAT_COUNT) {
      throw new Error(
        `WebXRQuaternionBridge requires at least ${MIN_UNIFORM_FLOAT_COUNT} floats to match the GlassUniformLayout.`,
      );
    }
    this.uniformFloatCount = requestedFloatCount;
    this.uniformArray = requestedFloatCount === MIN_UNIFORM_FLOAT_COUNT
      ? createFloat32ArrayForLayout(GlassUniformLayout)
      : new Float32Array(requestedFloatCount);
    this.logger = options.logger;
  }

  /**
   * Updates the glass composer uniform ring from the provided XR frame.
   * Returns the Float32Array that was uploaded or null when no pose is available.
   */
  updateFromXRFrame(frame: XRFrameLike, options: UpdateUniformOptions): Float32Array | null {
    if (!frame || typeof frame.getViewerPose !== 'function') {
      throw new Error('WebXRQuaternionBridge.updateFromXRFrame requires a valid XR frame');
    }
    const pose = frame.getViewerPose(options.referenceSpace);
    if (!pose || !pose.views || pose.views.length === 0) {
      this.logger?.warn?.('[WebXRQuaternionBridge] Skipping frame: viewer pose unavailable');
      return null;
    }

    const leftView = pose.views[0];
    const rightView = pose.views[1] ?? pose.views[0];

    const leftProjection = getMatrix4(leftView.projectionMatrix);
    const leftViewMatrix = getMatrix4(leftView.transform.inverse?.matrix ?? leftView.transform.matrix);
    const rightProjection = getMatrix4(rightView.projectionMatrix);
    const rightViewMatrix = getMatrix4(rightView.transform.inverse?.matrix ?? rightView.transform.matrix);

    const leftViewProj = multiplyMat4(leftProjection, leftViewMatrix);
    const rightViewProj = multiplyMat4(rightProjection, rightViewMatrix);

    const headTransform = pose.transform ?? leftView.transform;
    const quaternion = quaternionFromLike(headTransform?.orientation ?? leftView.transform.orientation);
    if (!quaternion) {
      this.logger?.warn?.('[WebXRQuaternionBridge] Viewer pose missing orientation quaternion');
      return null;
    }

    const snapshot = deriveRotorSnapshot(quaternion);
    const position = vec3FromLike(headTransform?.position ?? leftView.transform.position);

    const uniforms = this.uniformArray;
    uniforms.fill(0);

    writeField(GlassUniformLayout, uniforms, 'leftViewProj', leftViewProj);
    writeField(GlassUniformLayout, uniforms, 'rightViewProj', rightViewProj);

    const headMatrix = [...snapshot.matrix4];
    headMatrix[12] = position[0];
    headMatrix[13] = position[1];
    headMatrix[14] = position[2];
    writeField(GlassUniformLayout, uniforms, 'headMatrix', headMatrix);

    const rotorSource = options.rotorOverride ?? snapshot.rotor4d;
    const rotor = [rotorSource[0], rotorSource[1], rotorSource[2], 0];
    writeField(GlassUniformLayout, uniforms, 'rotor4d', rotor);

    const euler = [snapshot.euler[0], snapshot.euler[1], snapshot.euler[2], 0];
    writeField(GlassUniformLayout, uniforms, 'euler', euler);

    const deltaTime = options.deltaTime ?? (this.lastFrameTime == null ? 0 : options.frameTime - this.lastFrameTime);
    this.lastFrameTime = options.frameTime;
    const confidence = clamp01(options.confidence ?? 1);
    const metrics = [options.frameTime, deltaTime, confidence, pose.views.length];
    writeField(GlassUniformLayout, uniforms, 'metrics', metrics);

    const audio = resolveAudioBands(options.audio);
    writeField(GlassUniformLayout, uniforms, 'audio', audio);

    const localization = resolveLocalizationUniform(options.localization);
    if (GlassUniformLayout.fields.localization) {
      writeField(GlassUniformLayout, uniforms, 'localization', localization);
    }

    const visualField = GlassUniformLayout.fields.visual;
    if (visualField && this.uniformFloatCount * Float32Array.BYTES_PER_ELEMENT >= visualField.offset + visualField.size) {
      const visual = resolveVisualParams(options.visualParams);
      writeField(GlassUniformLayout, uniforms, 'visual', visual);
    }

    const material = resolveMaterialScalars(options.material);
    writeField(GlassUniformLayout, uniforms, 'materialScalarsA', material.scalarsA);
    writeField(GlassUniformLayout, uniforms, 'materialScalarsB', material.scalarsB);
    writeField(GlassUniformLayout, uniforms, 'materialScalarsC', material.scalarsC);

    const palette = resolveMaterialPalette(options.palette);
    writeField(GlassUniformLayout, uniforms, 'materialPrimary', palette.primary);
    writeField(GlassUniformLayout, uniforms, 'materialSecondary', palette.secondary);
    writeField(GlassUniformLayout, uniforms, 'materialBackground', palette.background);

    this.composer.updateUniforms(uniforms);
    return uniforms;
  }
}

export default WebXRQuaternionBridge;
