import { deriveRotorSnapshot, normalize as normalizeQuaternionTuple } from '../../../../core/quaternion/index.ts';
import type { Quaternion } from '../../../../core/quaternion/index.ts';
import {
  GlassUniformLayout,
  createFloat32ArrayForLayout,
  writeField,
} from './BufferLayout.ts';
import type { MultiLayerGlassComposer } from './MultiLayerGlassComposer.ts';

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

    const rotor = [snapshot.rotor4d[0], snapshot.rotor4d[1], snapshot.rotor4d[2], 0];
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

    const visualField = GlassUniformLayout.fields.visual;
    if (visualField && this.uniformFloatCount * Float32Array.BYTES_PER_ELEMENT >= visualField.offset + visualField.size) {
      const visual = resolveVisualParams(options.visualParams);
      writeField(GlassUniformLayout, uniforms, 'visual', visual);
    }

    this.composer.updateUniforms(uniforms);
    return uniforms;
  }
}

export default WebXRQuaternionBridge;
