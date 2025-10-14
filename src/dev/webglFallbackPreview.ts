import { GeometryManager, ProjectionManager, ShaderManager } from '../core/shaders/DynamicShaderModules.js';
import {
  IDENTITY_QUATERNION,
  normalize as normalizeQuaternion,
  quaternionToEuler,
  type Quaternion,
} from '../core/quaternion/index.ts';
import type { AudioBands, VisualParameterVector } from '../ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';
import type { StoryTriggerActivation } from '../ui/adaptive/localization/SpatialStoryGraph.ts';

export interface WebGLFallbackPreviewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly geometry?: 'hypercube' | 'hypersphere' | 'hypertetrahedron';
  readonly projection?: 'perspective' | 'orthographic' | 'stereographic';
  readonly onFrame?: (info: { fps: number }) => void;
}

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

type UniformMap = Record<
  | 'u_resolution'
  | 'u_time'
  | 'u_dimension'
  | 'u_morphFactor'
  | 'u_rotationSpeed'
  | 'u_universeModifier'
  | 'u_patternIntensity'
  | 'u_gridDensity'
  | 'u_lineThickness'
  | 'u_shellWidth'
  | 'u_tetraThickness'
  | 'u_audioBass'
  | 'u_audioMid'
  | 'u_audioHigh'
  | 'u_glitchIntensity'
  | 'u_colorShift'
  | 'u_primaryColor'
  | 'u_secondaryColor'
  | 'u_backgroundColor',
  WebGLUniformLocation | null
>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const DEFAULT_AUDIO = Object.freeze({ bass: 0, mid: 0, high: 0, energy: 0 }) as Required<AudioBands>;

const DEFAULT_VISUAL: Required<VisualParameterVector> = Object.freeze({
  dimension: 3.6,
  morphFactor: 0.45,
  rotationSpeed: 0.25,
  universeModifier: 1,
});

export default class WebGLFallbackPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: GLContext;
  private readonly geometry: 'hypercube' | 'hypersphere' | 'hypertetrahedron';
  private readonly projection: 'perspective' | 'orthographic' | 'stereographic';
  private readonly onFrame?: (info: { fps: number }) => void;

  private readonly shaderManager: ShaderManager;
  private readonly program: WebGLProgram;
  private readonly uniforms: UniformMap;
  private readonly attributeLocation: number;
  private readonly buffer: WebGLBuffer;

  private running = false;
  private rafHandle: number | null = null;
  private readonly startTime = performance.now();
  private lastTimestamp = performance.now();
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private pulseIntensity = 0;

  private state = {
    quaternion: IDENTITY_QUATERNION as Quaternion,
    audio: DEFAULT_AUDIO,
    confidence: 1,
    visual: DEFAULT_VISUAL,
  };

  constructor(options: WebGLFallbackPreviewOptions) {
    this.canvas = options.canvas;
    this.geometry = options.geometry ?? 'hypersphere';
    this.projection = options.projection ?? 'perspective';
    this.onFrame = options.onFrame;

    const gl =
      this.canvas.getContext('webgl2', { premultipliedAlpha: true }) ??
      this.canvas.getContext('webgl', { premultipliedAlpha: true }) ??
      this.canvas.getContext('experimental-webgl');

    if (!gl) {
      throw new Error('WebGL fallback renderer could not acquire a context');
    }

    this.gl = gl;

    const geometryManager = new GeometryManager();
    const projectionManager = new ProjectionManager();
    this.shaderManager = new ShaderManager(this.gl, geometryManager, projectionManager);

    const program = this.shaderManager.createDynamicProgram(
      'webgl-fallback',
      this.geometry,
      this.projection,
    );

    if (!program) {
      throw new Error('Failed to compile WebGL fallback shader program');
    }

    this.shaderManager.useProgram('webgl-fallback');
    this.program = program;

    this.uniforms = {
      u_resolution: this.shaderManager.getUniformLocation('u_resolution'),
      u_time: this.shaderManager.getUniformLocation('u_time'),
      u_dimension: this.shaderManager.getUniformLocation('u_dimension'),
      u_morphFactor: this.shaderManager.getUniformLocation('u_morphFactor'),
      u_rotationSpeed: this.shaderManager.getUniformLocation('u_rotationSpeed'),
      u_universeModifier: this.shaderManager.getUniformLocation('u_universeModifier'),
      u_patternIntensity: this.shaderManager.getUniformLocation('u_patternIntensity'),
      u_gridDensity: this.shaderManager.getUniformLocation('u_gridDensity'),
      u_lineThickness: this.shaderManager.getUniformLocation('u_lineThickness'),
      u_shellWidth: this.shaderManager.getUniformLocation('u_shellWidth'),
      u_tetraThickness: this.shaderManager.getUniformLocation('u_tetraThickness'),
      u_audioBass: this.shaderManager.getUniformLocation('u_audioBass'),
      u_audioMid: this.shaderManager.getUniformLocation('u_audioMid'),
      u_audioHigh: this.shaderManager.getUniformLocation('u_audioHigh'),
      u_glitchIntensity: this.shaderManager.getUniformLocation('u_glitchIntensity'),
      u_colorShift: this.shaderManager.getUniformLocation('u_colorShift'),
      u_primaryColor: this.shaderManager.getUniformLocation('u_primaryColor'),
      u_secondaryColor: this.shaderManager.getUniformLocation('u_secondaryColor'),
      u_backgroundColor: this.shaderManager.getUniformLocation('u_backgroundColor'),
    };

    const attribute = this.shaderManager.getAttributeLocation('a_position');
    this.attributeLocation = attribute ?? 0;

    const buffer = this.gl.createBuffer();
    if (!buffer) {
      throw new Error('Failed to allocate buffer for WebGL fallback renderer');
    }
    this.buffer = buffer;

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      this.gl.STATIC_DRAW,
    );

    this.gl.enableVertexAttribArray(this.attributeLocation);
    this.gl.vertexAttribPointer(this.attributeLocation, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.clearColor(0.03, 0.04, 0.09, 1);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastTimestamp = performance.now();
    this.rafHandle = requestAnimationFrame(this.handleFrame);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose(): void {
    this.stop();
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram?.(this.program);
  }

  setQuaternion(quaternion: Quaternion): void {
    this.state = {
      ...this.state,
      quaternion: normalizeQuaternion(quaternion),
    };
  }

  setAudioBands(bands: AudioBands): void {
    const bass = clamp01(bands?.bass ?? this.state.audio.bass);
    const mid = clamp01(bands?.mid ?? this.state.audio.mid);
    const high = clamp01(bands?.high ?? this.state.audio.high);
    const energy = clamp01(bands?.energy ?? Math.max(bass, mid, high));
    this.state = {
      ...this.state,
      audio: { bass, mid, high, energy },
    };
  }

  setConfidence(confidence: number): void {
    this.state = {
      ...this.state,
      confidence: clamp01(confidence),
    };
  }

  setVisualParams(vector: VisualParameterVector): void {
    this.state = {
      ...this.state,
      visual: {
        dimension: Number(vector.dimension ?? this.state.visual.dimension),
        morphFactor: Number(vector.morphFactor ?? this.state.visual.morphFactor),
        rotationSpeed: Number(vector.rotationSpeed ?? this.state.visual.rotationSpeed),
        universeModifier: Number(vector.universeModifier ?? this.state.visual.universeModifier),
      },
    };
  }

  pulse(intensity = 1): void {
    this.pulseIntensity = Math.min(1, this.pulseIntensity + Math.max(0, intensity));
  }

  listRisks(): string[] {
    return [
      `WebGPU unavailable — rendering with WebGL fallback shader (${this.geometry} geometry • ${this.projection} projection).`,
      'Predictive rotor telemetry is disabled in fallback mode.',
    ];
  }

  listStoryActivations(): StoryTriggerActivation[] {
    return [
      {
        pluginId: 'webgl-fallback',
        label: 'WebGL fallback active',
        intensity: 0.25,
        details: { renderer: 'webgl', geometry: this.geometry, projection: this.projection },
      },
    ];
  }

  getPredictionSnapshot(): null {
    return null;
  }

  private readonly handleFrame = (timestamp: number) => {
    if (!this.running) {
      return;
    }

    const deltaTime = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    this.pulseIntensity = Math.max(0, this.pulseIntensity - deltaTime * 0.7);

    this.render(timestamp * 0.001);
    this.updateFps(deltaTime);

    this.rafHandle = requestAnimationFrame(this.handleFrame);
  };

  private render(timeSeconds: number): void {
    this.resize();

    this.gl.useProgram(this.program);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    const { quaternion, audio, confidence, visual } = this.state;
    const [, pitch, roll] = quaternionToEuler(quaternion);
    const attitudeEnergy = clamp01(Math.hypot(quaternion[0], quaternion[1], quaternion[2]));

    const rotationSpeed = visual.rotationSpeed * (0.7 + audio.high * 0.8) + Math.abs(roll) * 0.15;
    const morphFactor = clamp01(visual.morphFactor + attitudeEnergy * 0.18 + audio.mid * 0.25);
    const dimension = visual.dimension + audio.energy * 0.9 + this.pulseIntensity * 0.5;
    const universeModifier = visual.universeModifier + this.pulseIntensity * 0.35;
    const patternIntensity = 0.8 + visual.universeModifier * 0.2 + this.pulseIntensity * 0.6;
    const gridDensity = 6.5 + universeModifier * 2.4 + audio.bass * 4.2;
    const colorShift = (audio.high - audio.bass) * 0.35;
    const glitchIntensity = (1 - confidence) * 0.45;

    this.setUniform2f('u_resolution', this.canvas.width, this.canvas.height);
    this.setUniform1f('u_time', timeSeconds);
    this.setUniform1f('u_dimension', dimension);
    this.setUniform1f('u_morphFactor', morphFactor);
    this.setUniform1f('u_rotationSpeed', rotationSpeed);
    this.setUniform1f('u_universeModifier', universeModifier);
    this.setUniform1f('u_patternIntensity', patternIntensity);
    this.setUniform1f('u_gridDensity', gridDensity);
    this.setUniform1f('u_lineThickness', lerp(0.02, 0.045, audio.energy));
    this.setUniform1f('u_shellWidth', lerp(0.02, 0.06, audio.mid));
    this.setUniform1f('u_tetraThickness', lerp(0.02, 0.05, audio.energy));
    this.setUniform1f('u_audioBass', audio.bass);
    this.setUniform1f('u_audioMid', audio.mid);
    this.setUniform1f('u_audioHigh', audio.high);
    this.setUniform1f('u_glitchIntensity', glitchIntensity);
    this.setUniform1f('u_colorShift', colorShift);

    this.setUniform3f('u_primaryColor', 0.95, 0.25, 0.85);
    this.setUniform3f('u_secondaryColor', 0.25, 0.95, 0.95);
    this.setUniform3f('u_backgroundColor', 0.05, 0.02, 0.18);

    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  private updateFps(delta: number): void {
    if (!this.onFrame || delta <= 0) {
      return;
    }
    this.fpsAccumulator += delta;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      const fps = this.fpsFrames / this.fpsAccumulator;
      this.onFrame?.({ fps });
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
  }

  private setUniform1f(name: keyof UniformMap, value: number): void {
    const location = this.uniforms[name];
    if (location) {
      this.gl.uniform1f(location, value);
    }
  }

  private setUniform2f(name: keyof UniformMap, x: number, y: number): void {
    const location = this.uniforms[name];
    if (location) {
      this.gl.uniform2f(location, x, y);
    }
  }

  private setUniform3f(name: keyof UniformMap, x: number, y: number, z: number): void {
    const location = this.uniforms[name];
    if (location) {
      this.gl.uniform3f(location, x, y, z);
    }
  }
}
