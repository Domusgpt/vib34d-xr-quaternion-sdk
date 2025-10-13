import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { SensoryInputBridge } from '../ui/adaptive/SensoryInputBridge.js';

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

const degToRad = (value: number) => (value * Math.PI) / 180;

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

  const initialAngles = options.initialAngles ?? { yaw: 20, pitch: 12, roll: -18 };
  const yaw = createSlider(controls, 'Yaw (°)', { min: -180, max: 180, step: 1, value: initialAngles.yaw });
  const pitch = createSlider(controls, 'Pitch (°)', { min: -90, max: 90, step: 1, value: initialAngles.pitch });
  const roll = createSlider(controls, 'Roll (°)', { min: -180, max: 180, step: 1, value: initialAngles.roll });
  const confidence = createSlider(controls, 'Confidence', { min: 0, max: 1, step: 0.05, value: options.initialConfidence ?? 0.85 });

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

  const lastQuaternion = document.createElement('pre');
  lastQuaternion.className = 'qp-quaternion';
  statusPanel.appendChild(lastQuaternion);

  const emitUpdate = () => {
    const yawValue = Number(yaw.input.value);
    const pitchValue = Number(pitch.input.value);
    const rollValue = Number(roll.input.value);
    const confidenceValue = Number(confidence.input.value);

    const quaternion = eulerToQuaternion(yawValue, pitchValue, rollValue);

    bridge.ingest(
      'spatial.pose',
      {
        orientation: quaternion,
        position: { x: 0, y: 0, z: 0 },
        timestamp: performance.now()
      },
      confidenceValue
    );

    statusText.textContent = `Confidence ${formatNumber(confidenceValue)} • Motion energy ${formatNumber(
      synchronizer.motionEnergy
    )}`;

    lastQuaternion.textContent = JSON.stringify(quaternion, null, 2);
  };

  const handleInput = () => {
    emitUpdate();
  };

  yaw.input.addEventListener('input', handleInput);
  pitch.input.addEventListener('input', handleInput);
  roll.input.addEventListener('input', handleInput);
  confidence.input.addEventListener('input', handleInput);
  pulseButton.addEventListener('click', () => {
    emitUpdate();
  });

  container.appendChild(root);
  emitUpdate();

  return {
    bridge,
    synchronizer,
    destroy() {
      synchronizer.stop();
      systems.quantum.destroy();
      systems.holographic.destroy();
      systems.faceted.destroy();
      container.removeChild(root);
    }
  };
}
