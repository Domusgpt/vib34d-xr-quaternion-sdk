import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { SensoryInputBridge } from '../ui/adaptive/SensoryInputBridge.js';
import type { StoryTriggerActivation } from '../ui/adaptive/localization/SpatialStoryGraph.ts';
import WebGPUPreviewHarness from './webgpuPreviewHarness.ts';
import WebGLFallbackPreview from './webglFallbackPreview.ts';

export interface QuaternionPreviewOptions {
  heading?: string;
  initialAngles?: { yaw: number; pitch: number; roll: number };
  initialConfidence?: number;
}

interface ControlHandle {
  input: HTMLInputElement;
  valueLabel: HTMLElement;
}

class MockQuaternionSystem {
  public readonly parameters = new Map<string, number>();
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();

  constructor(
    private readonly name: string,
    private readonly parent: HTMLElement,
    defaults: Record<string, number>
  ) {
    this.root = document.createElement('section');
    this.root.className = 'qp-system';

    const title = document.createElement('h3');
    title.textContent = name;
    this.root.appendChild(title);

    this.list = document.createElement('dl');
    this.list.className = 'qp-parameter-list';
    this.root.appendChild(this.list);

    parent.appendChild(this.root);

    for (const [key, value] of Object.entries(defaults)) {
      this.parameters.set(key, value);
      this.ensureRow(key).textContent = formatNumber(value);
    }
  }

  updateParameter(key: string, value: number) {
    this.parameters.set(key, value);
    this.ensureRow(key).textContent = formatNumber(value);
  }

  getParameter(key: string) {
    return this.parameters.get(key) ?? 0;
  }

  private ensureRow(key: string) {
    let valueElement = this.values.get(key);
    if (valueElement) {
      return valueElement;
    }

    const term = document.createElement('dt');
    term.textContent = key;
    this.list.appendChild(term);

    valueElement = document.createElement('dd');
    valueElement.textContent = '0';
    this.list.appendChild(valueElement);

    this.values.set(key, valueElement);
    return valueElement;
  }

  destroy() {
    this.parent.removeChild(this.root);
    this.values.clear();
    this.parameters.clear();
  }
}

const formatNumber = (value: number) => value.toFixed(3);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const degToRad = (value: number) => (value * Math.PI) / 180;

type GeometryName = 'hypercube' | 'hypersphere' | 'hypertetrahedron';
type ProjectionName = 'perspective' | 'orthographic' | 'stereographic';

const eulerToQuaternion = (yawDeg: number, pitchDeg: number, rollDeg: number) => {
  const yaw = degToRad(yawDeg);
  const pitch = degToRad(pitchDeg);
  const roll = degToRad(rollDeg);

  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy
  };
};

const createSlider = (
  container: HTMLElement,
  label: string,
  options: { min: number; max: number; step: number; value: number }
): ControlHandle => {
  const wrapper = document.createElement('label');
  wrapper.className = 'qp-control';
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.appendChild(text);

  const valueLabel = document.createElement('span');
  valueLabel.className = 'qp-control-value';
  wrapper.appendChild(valueLabel);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  wrapper.appendChild(input);

  container.appendChild(wrapper);

  valueLabel.textContent = formatNumber(Number(input.value));

  input.addEventListener('input', () => {
    valueLabel.textContent = formatNumber(Number(input.value));
  });

  return { input, valueLabel };
};

const createSelect = (
  container: HTMLElement,
  label: string,
  options: readonly { value: string; label: string }[],
  value: string
) => {
  const wrapper = document.createElement('label');
  wrapper.className = 'qp-select';

  const text = document.createElement('span');
  text.textContent = label;
  wrapper.appendChild(text);

  const select = document.createElement('select');
  options.forEach(option => {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  });
  select.value = value;
  wrapper.appendChild(select);

  container.appendChild(wrapper);
  return select;
};

export function createQuaternionPreview(
  container: HTMLElement,
  options: QuaternionPreviewOptions = {}
) {
  const root = document.createElement('div');
  root.className = 'quaternion-preview';

  const heading = document.createElement('h2');
  heading.textContent = options.heading ?? 'Quaternion Fabric Preview';
  root.appendChild(heading);

  const layout = document.createElement('div');
  layout.className = 'qp-layout';
  root.appendChild(layout);

  const controls = document.createElement('div');
  controls.className = 'qp-controls';
  layout.appendChild(controls);

  const systemsColumn = document.createElement('div');
  systemsColumn.className = 'qp-systems';
  layout.appendChild(systemsColumn);

  const statusPanel = document.createElement('div');
  statusPanel.className = 'qp-status';
  root.appendChild(statusPanel);

  const webgpuSection = document.createElement('section');
  webgpuSection.className = 'qp-webgpu';

  const webgpuHeading = document.createElement('h3');
  webgpuHeading.textContent = 'WebGPU Glass Composer Preview';
  webgpuSection.appendChild(webgpuHeading);

  const webgpuCanvas = document.createElement('canvas');
  webgpuCanvas.className = 'qp-webgpu-canvas';
  webgpuSection.appendChild(webgpuCanvas);

  const webgpuStatus = document.createElement('p');
  webgpuStatus.className = 'qp-webgpu-status';
  webgpuStatus.textContent = 'Checking WebGPU support…';
  webgpuSection.appendChild(webgpuStatus);

  const webgpuFps = document.createElement('p');
  webgpuFps.className = 'qp-webgpu-fps';
  webgpuFps.textContent = 'FPS';
  const webgpuFpsValue = document.createElement('span');
  webgpuFpsValue.className = 'qp-webgpu-fps-value';
  webgpuFpsValue.textContent = '0.0';
  webgpuFps.appendChild(webgpuFpsValue);
  webgpuSection.appendChild(webgpuFps);

  const riskList = document.createElement('ul');
  riskList.className = 'qp-risk-list';
  webgpuSection.appendChild(riskList);

  statusPanel.appendChild(webgpuSection);

  const storySection = document.createElement('section');
  storySection.className = 'qp-story';
  const storyHeading = document.createElement('h3');
  storyHeading.textContent = 'Active Story Events';
  storySection.appendChild(storyHeading);

  const storyList = document.createElement('ul');
  storyList.className = 'qp-story-list';
  storySection.appendChild(storyList);

  statusPanel.appendChild(storySection);

  const updateRiskList = (risks: string[]) => {
    riskList.textContent = '';
    if (risks.length === 0) {
      const okItem = document.createElement('li');
      okItem.textContent = 'No configuration risks detected for current layer plan.';
      riskList.appendChild(okItem);
      return;
    }
    risks.forEach(risk => {
      const item = document.createElement('li');
      item.textContent = risk;
      riskList.appendChild(item);
    });
  };

  const updateStoryList = (activations: StoryTriggerActivation[]) => {
    storyList.textContent = '';
    if (!activations.length) {
      const idle = document.createElement('li');
      idle.textContent = 'Story graph idle — no triggers active.';
      storyList.appendChild(idle);
      return;
    }
    activations.forEach(activation => {
      const item = document.createElement('li');
      const intensity = Math.round(clamp01(activation.intensity) * 100);
      const detailEntries = activation.details
        ? Object.entries(activation.details)
            .map(([key, value]) => `${key}: ${typeof value === 'number' ? formatNumber(value as number) : String(value)}`)
            .join(' • ')
        : '';
      const meta = detailEntries ? ` • ${detailEntries}` : '';
      item.textContent = `${activation.label} — ${intensity}%${meta}`;
      storyList.appendChild(item);
    });
  };

  const geometryOptions = [
    { value: 'hypercube', label: 'Hypercube' },
    { value: 'hypersphere', label: 'Hypersphere' },
    { value: 'hypertetrahedron', label: 'Hypertetrahedron' },
  ] as const satisfies readonly { value: GeometryName; label: string }[];

  const projectionOptions = [
    { value: 'perspective', label: 'Perspective Projection' },
    { value: 'orthographic', label: 'Orthographic Projection' },
    { value: 'stereographic', label: 'Stereographic Projection' },
  ] as const satisfies readonly { value: ProjectionName; label: string }[];

  let selectedGeometry: GeometryName = 'hypersphere';
  let selectedProjection: ProjectionName = 'perspective';

  let webgpuHarness: WebGPUPreviewHarness | null = null;
  let webglFallback: WebGLFallbackPreview | null = null;

  let initializationToken = 0;

  const describeSelection = () => `${selectedGeometry} geometry • ${selectedProjection} projection`;

  const disposeActiveRenderers = () => {
    webgpuHarness?.stop();
    webgpuHarness?.dispose();
    webgpuHarness = null;
    webglFallback?.dispose();
    webglFallback = null;
  };

  const startWebGLFallback = () => {
    disposeActiveRenderers();
    webgpuFpsValue.textContent = '0.0';
    try {
      webglFallback = new WebGLFallbackPreview({
        canvas: webgpuCanvas,
        geometry: selectedGeometry,
        projection: selectedProjection,
        onFrame: ({ fps }) => {
          webgpuFpsValue.textContent = fps.toFixed(1);
          if (webglFallback) {
            updateRiskList(webglFallback.listRisks());
            updateStoryList(webglFallback.listStoryActivations());
            updatePrediction(webglFallback.getPredictionSnapshot());
          }
        }
      });
      webglFallback.start();
      webgpuStatus.textContent = `WebGPU unavailable — WebGL fallback active (${describeSelection()}).`;
      updateRiskList(webglFallback.listRisks());
      updateStoryList(webglFallback.listStoryActivations());
      updatePrediction(webglFallback.getPredictionSnapshot());
      emitUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webgpuStatus.textContent = `WebGL fallback failed: ${message}`;
      updateRiskList([]);
      updateStoryList([]);
      updatePrediction(null);
    }
  };

  const initializeWebGPU = async () => {
    const initId = ++initializationToken;
    webgpuStatus.textContent = 'Initializing WebGPU glass composer…';
    webgpuFpsValue.textContent = '0.0';
    disposeActiveRenderers();
    updateRiskList([]);
    updateStoryList([]);
    updatePrediction(null);

    const navGpu = (typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: unknown }).gpu : undefined) as
      | {
          requestAdapter?: (options?: unknown) => Promise<unknown>;
        }
      | undefined;

    if (!navGpu?.requestAdapter) {
      if (initId === initializationToken) {
        webgpuStatus.textContent = 'WebGPU not available — switching to WebGL fallback.';
        startWebGLFallback();
      }
      return;
    }

    try {
      const harness = await WebGPUPreviewHarness.create({
        canvas: webgpuCanvas,
        geometry: selectedGeometry,
        projection: selectedProjection,
        onFrame: ({ fps }) => {
          webgpuFpsValue.textContent = fps.toFixed(1);
          if (webgpuHarness) {
            updateRiskList(webgpuHarness.listRisks());
            updateStoryList(webgpuHarness.listStoryActivations());
            updatePrediction(webgpuHarness.getPredictionSnapshot());
          }
        }
      });

      if (initId !== initializationToken) {
        harness.dispose();
        return;
      }

      webgpuHarness = harness;
      updateRiskList(webgpuHarness.listRisks());
      updateStoryList(webgpuHarness.listStoryActivations());
      webgpuStatus.textContent = `WebGPU glass composer ready — ${describeSelection()}.`;
      webgpuHarness.start();
      emitUpdate();
    } catch (error) {
      if (initId !== initializationToken) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      webgpuStatus.textContent = `WebGPU init failed (${message}) — activating WebGL fallback.`;
      webgpuHarness = null;
      startWebGLFallback();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => webgpuHarness?.forceResize());
  }

  const initialAngles = options.initialAngles ?? { yaw: 20, pitch: 12, roll: -18 };
  const yaw = createSlider(controls, 'Yaw (°)', { min: -180, max: 180, step: 1, value: initialAngles.yaw });
  const pitch = createSlider(controls, 'Pitch (°)', { min: -90, max: 90, step: 1, value: initialAngles.pitch });
  const roll = createSlider(controls, 'Roll (°)', { min: -180, max: 180, step: 1, value: initialAngles.roll });
  const confidence = createSlider(controls, 'Confidence', { min: 0, max: 1, step: 0.05, value: options.initialConfidence ?? 0.85 });

  const geometrySelect = createSelect(controls, 'Geometry Module', geometryOptions, selectedGeometry);
  const projectionSelect = createSelect(controls, 'Projection Mode', projectionOptions, selectedProjection);

  const pulseButton = document.createElement('button');
  pulseButton.className = 'qp-button';
  pulseButton.type = 'button';
  pulseButton.textContent = 'Pulse Update';
  controls.appendChild(pulseButton);

  const bridge = new SensoryInputBridge({
    autoConnectAdapters: false,
    confidenceThreshold: 0,
    channelHistoryLimit: 4
  });

  const systems = {
    quantum: new MockQuaternionSystem('Quantum Engine', systemsColumn, {
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      chaos: 0.2,
      intensity: 0.7
    }),
    holographic: new MockQuaternionSystem('Holographic Engine', systemsColumn, {
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      hue: 320,
      saturation: 0.9
    }),
    faceted: new MockQuaternionSystem('Faceted System', systemsColumn, {
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      speed: 1
    })
  } satisfies Record<string, MockQuaternionSystem>;

  const synchronizer = new ShaderQuaternionSynchronizer({
    bridge,
    systems,
    baseAlpha: 0.3,
    minConfidence: 0.05,
    energySmoothing: 0.25,
    velocityReference: 6
  });

  synchronizer.start();

  const statusText = document.createElement('p');
  statusText.className = 'qp-status-line';
  statusPanel.appendChild(statusText);

  const predictionText = document.createElement('p');
  predictionText.className = 'qp-status-line';
  statusPanel.appendChild(predictionText);

  const lastQuaternion = document.createElement('pre');
  lastQuaternion.className = 'qp-quaternion';
  statusPanel.appendChild(lastQuaternion);

  function emitUpdate() {
    const yawValue = Number(yaw.input.value);
    const pitchValue = Number(pitch.input.value);
    const rollValue = Number(roll.input.value);
    const confidenceValue = Number(confidence.input.value);

    const quaternion = eulerToQuaternion(yawValue, pitchValue, rollValue);
    const quatTuple: [number, number, number, number] = [
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w
    ];

    const energy = clamp01(Math.abs(synchronizer.motionEnergy) / 4);
    const audioBands = {
      bass: clamp01(Math.abs(quaternion.x) * 0.8 + energy * 0.25),
      mid: clamp01(Math.abs(quaternion.y) * 0.8 + energy * 0.2),
      high: clamp01(Math.abs(quaternion.z) * 0.8 + energy * 0.35),
      energy
    } as const;
    const morphFactor = clamp01(
      (Math.abs(pitchValue) / 90 + Math.abs(rollValue) / 180) * 0.5 + energy * 0.3
    );
    const visualVector = {
      dimension: 3.2 + energy * 1.8,
      morphFactor,
      rotationSpeed: 0.2 + energy * 1.4,
      universeModifier: 1 + energy * 0.5
    } as const;

    bridge.ingest(
      'spatial.pose',
      {
        orientation: quaternion,
        position: { x: 0, y: 0, z: 0 },
        timestamp: performance.now()
      },
      confidenceValue
    );

    if (webgpuHarness) {
      webgpuHarness.setQuaternion(quatTuple);
      webgpuHarness.setConfidence(confidenceValue);
      webgpuHarness.setAudioBands(audioBands);
      webgpuHarness.setVisualParams(visualVector);
    }

    if (webglFallback) {
      webglFallback.setQuaternion(quatTuple);
      webglFallback.setConfidence(confidenceValue);
      webglFallback.setAudioBands(audioBands);
      webglFallback.setVisualParams(visualVector);
    }

    statusText.textContent = `Confidence ${formatNumber(confidenceValue)} • Motion energy ${formatNumber(
      synchronizer.motionEnergy
    )}`;

    updatePrediction(webgpuHarness?.getPredictionSnapshot() ?? webglFallback?.getPredictionSnapshot() ?? null);

    lastQuaternion.textContent = JSON.stringify(quaternion, null, 2);
  }

  function updatePrediction(
    snapshot: ReturnType<WebGPUPreviewHarness['getPredictionSnapshot']> | null
  ) {
    if (!snapshot) {
      predictionText.textContent = 'Predictive rotor cache warming — awaiting samples.';
      return;
    }
    const [xw, yw, zw] = snapshot.rotor;
    predictionText.textContent = `Predictive horizon ${formatNumber(snapshot.horizonMs)} ms • Confidence ${Math.round(
      clamp01(snapshot.confidence) * 100
    )}% • Rotor [${formatNumber(xw)}, ${formatNumber(yw)}, ${formatNumber(zw)}]`;
  }

  const handleInput = () => {
    emitUpdate();
  };

  yaw.input.addEventListener('input', handleInput);
  pitch.input.addEventListener('input', handleInput);
  roll.input.addEventListener('input', handleInput);
  confidence.input.addEventListener('input', handleInput);
  geometrySelect.addEventListener('change', () => {
    const value = geometrySelect.value as GeometryName;
    if (value !== selectedGeometry) {
      selectedGeometry = value;
      void initializeWebGPU();
    }
  });
  projectionSelect.addEventListener('change', () => {
    const value = projectionSelect.value as ProjectionName;
    if (value !== selectedProjection) {
      selectedProjection = value;
      void initializeWebGPU();
    }
  });
  pulseButton.addEventListener('click', () => {
    emitUpdate();
    webgpuHarness?.pulse(0.9);
    webglFallback?.pulse(0.9);
  });

  container.appendChild(root);
  emitUpdate();

  void initializeWebGPU();

  return {
    bridge,
    synchronizer,
    destroy() {
      synchronizer.stop();
      systems.quantum.destroy();
      systems.holographic.destroy();
      systems.faceted.destroy();
      webgpuHarness?.stop();
      webglFallback?.dispose();
      container.removeChild(root);
    }
  };
}
